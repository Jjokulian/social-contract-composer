-- Social Contract Composer — the store.
--
-- One normalized database. Each fact is recorded once, and every reference is
-- a foreign key. Nano and contract revisions are append-only: to change one,
-- add a new revision.
--
-- The schema does storage and integrity: references, kinds, immutability.
-- Composition (public/compose.mjs) and evaluation (public/evaluate.mjs) are
-- pure JavaScript over the catalogue exported by server/store.mjs, shared by
-- the server, the static build and the browser.

PRAGMA foreign_keys = ON;

-- ─── Vocabularies ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kind (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO kind (name, description) VALUES
  ('intent',     'A purpose people can grasp directly'),
  ('clause',     'An agreement: who commits to what'),
  ('definition', 'A term and its meaning'),
  ('parameter',  'A term adopters set, within a domain'),
  ('measure',    'Something observable in a society'),
  ('assumption', 'A belief about the society, ideally a condition on a measure'),
  ('claim',      'How one nano relates to another, and the context that relation depends on'),
  ('evaluation', 'An observed value of a measure in a named society');
INSERT OR IGNORE INTO kind (name, description) VALUES
  ('influence',  'How one measure bears on another measure or on an intent, stated without committing to its truth');

CREATE TABLE IF NOT EXISTS author (
  id    TEXT PRIMARY KEY,               -- a GitHub handle or a named group
  label TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS role (       -- who a clause binds
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS term (       -- what definitions define; two definitions of one term in a composition clash
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS unit (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS society (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL
) STRICT;

-- ─── Nanos and their revisions ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nano (
  id   TEXT PRIMARY KEY CHECK (id <> '' AND id NOT GLOB '*[^a-z0-9.-]*'),
  kind TEXT NOT NULL REFERENCES kind(name)
) STRICT;

CREATE TABLE IF NOT EXISTS revision (
  rid        INTEGER PRIMARY KEY,
  nano_id    TEXT    NOT NULL REFERENCES nano(id),
  rev        INTEGER NOT NULL CHECK (rev >= 1),
  filed_by   TEXT    NOT NULL REFERENCES author(id),
  source     TEXT    NOT NULL,          -- provenance, e.g. 'draft:micro-social-contracts/pro-pregnancy/contract.md@5022a64' or 'issue:12'
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (nano_id, rev)
) STRICT;

CREATE VIEW IF NOT EXISTS revision_kind AS
  SELECT r.rid, r.nano_id, r.rev, n.kind
  FROM revision r JOIN nano n ON n.id = r.nano_id;

CREATE VIEW IF NOT EXISTS current_revision AS
  SELECT nano_id, MAX(rev) AS rev, (SELECT rid FROM revision x WHERE x.nano_id = r.nano_id ORDER BY rev DESC LIMIT 1) AS rid
  FROM revision r GROUP BY nano_id;

-- One body table per kind, keyed by the revision it belongs to.

CREATE TABLE IF NOT EXISTS intent_body (
  rid       INTEGER PRIMARY KEY REFERENCES revision(rid),
  statement TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS clause_body (
  rid      INTEGER PRIMARY KEY REFERENCES revision(rid),
  role_id  TEXT NOT NULL REFERENCES role(id),
  modality TEXT NOT NULL CHECK (modality IN ('shall', 'shall not', 'may')),
  text     TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS definition_body (
  rid     INTEGER PRIMARY KEY REFERENCES revision(rid),
  term_id TEXT NOT NULL REFERENCES term(id),
  meaning TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS parameter_body (
  rid     INTEGER PRIMARY KEY REFERENCES revision(rid),
  label   TEXT NOT NULL,
  unit_id TEXT NOT NULL REFERENCES unit(id),
  min     REAL NOT NULL,
  max     REAL NOT NULL,
  meaning TEXT NOT NULL,
  CHECK (min <= max)
) STRICT;

CREATE TABLE IF NOT EXISTS measure_body (
  rid         INTEGER PRIMARY KEY REFERENCES revision(rid),
  label       TEXT NOT NULL,
  unit_id     TEXT NOT NULL REFERENCES unit(id),
  description TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS assumption_body (
  rid         INTEGER PRIMARY KEY REFERENCES revision(rid),
  statement   TEXT NOT NULL,
  measure_rid INTEGER REFERENCES revision(rid),   -- the three condition columns are all set, or all NULL
  op          TEXT CHECK (op IN ('<', '<=', '>', '>=', '=')),
  value       REAL,
  CHECK ((measure_rid IS NULL) = (op IS NULL) AND (op IS NULL) = (value IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS claim_body (
  rid       INTEGER PRIMARY KEY REFERENCES revision(rid),
  from_rid  INTEGER NOT NULL REFERENCES revision(rid),
  relation  TEXT    NOT NULL CHECK (relation IN ('supports', 'hinders', 'conflicts')),
  to_rid    INTEGER NOT NULL REFERENCES revision(rid),
  strength  TEXT    NOT NULL DEFAULT 'contributes' CHECK (strength IN ('contributes', 'sufficient')),
  rationale TEXT    NOT NULL,
  CHECK (from_rid <> to_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS claim_given (      -- nanos that must be in the composition for the claim to apply
  claim_rid INTEGER NOT NULL REFERENCES claim_body(rid),
  nano_rid  INTEGER NOT NULL REFERENCES revision(rid),
  PRIMARY KEY (claim_rid, nano_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS claim_when (       -- conditions on parameter values chosen by adopters
  claim_rid     INTEGER NOT NULL REFERENCES claim_body(rid),
  parameter_rid INTEGER NOT NULL REFERENCES revision(rid),
  op            TEXT    NOT NULL CHECK (op IN ('<', '<=', '>', '>=', '=')),
  value         REAL    NOT NULL,
  PRIMARY KEY (claim_rid, parameter_rid, op)
) STRICT;

CREATE TABLE IF NOT EXISTS claim_assuming (   -- beliefs about the society the claim relies on
  claim_rid      INTEGER NOT NULL REFERENCES claim_body(rid),
  assumption_rid INTEGER NOT NULL REFERENCES revision(rid),
  PRIMARY KEY (claim_rid, assumption_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS claim_measure (    -- how a society would check the claim
  claim_rid   INTEGER NOT NULL REFERENCES claim_body(rid),
  measure_rid INTEGER NOT NULL REFERENCES revision(rid),
  PRIMARY KEY (claim_rid, measure_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS evaluation_body (
  rid         INTEGER PRIMARY KEY REFERENCES revision(rid),
  measure_rid INTEGER NOT NULL REFERENCES revision(rid),
  society_id  TEXT    NOT NULL REFERENCES society(id),
  value       REAL    NOT NULL,
  observed_on TEXT    NOT NULL,             -- ISO date or year
  source_url  TEXT    NOT NULL
) STRICT;

-- A determinant: what bears on a measure or an intent. Like a claim it is attributed and open to evaluation;
-- unlike a claim it never counts towards coverage.
CREATE TABLE IF NOT EXISTS influence_body (
  rid       INTEGER PRIMARY KEY REFERENCES revision(rid),
  from_rid  INTEGER NOT NULL REFERENCES revision(rid),
  direction TEXT    NOT NULL CHECK (direction IN ('raises', 'lowers', 'bears-on', 'stands-in-for')),
  to_rid    INTEGER NOT NULL REFERENCES revision(rid),
  rationale TEXT    NOT NULL,
  CHECK (from_rid <> to_rid)
) STRICT;

-- ─── Contracts: micro-social-contracts and Social Contracts ───────────────────

CREATE TABLE IF NOT EXISTS contract (
  id    TEXT PRIMARY KEY CHECK (id <> '' AND id NOT GLOB '*[^a-z0-9.-]*'),
  scale TEXT NOT NULL CHECK (scale IN ('micro', 'social'))
) STRICT;

CREATE TABLE IF NOT EXISTS contract_rev (
  crid        INTEGER PRIMARY KEY,
  contract_id TEXT    NOT NULL REFERENCES contract(id),
  rev         INTEGER NOT NULL CHECK (rev >= 1),
  title       TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('draft', 'proposed', 'adopted', 'retired')),
  filed_by    TEXT    NOT NULL REFERENCES author(id),
  source      TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (contract_id, rev)
) STRICT;

-- The intent tree. Nesting is contract-specific, so it lives here, not in the nanos.
-- Roots are the intents with no parent; no separate root column is stored.
CREATE TABLE IF NOT EXISTS contract_intent (
  crid       INTEGER NOT NULL REFERENCES contract_rev(crid),
  intent_rid INTEGER NOT NULL REFERENCES revision(rid),
  combine    TEXT    NOT NULL DEFAULT 'all' CHECK (combine IN ('all', 'any')),   -- how children roll up
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (crid, intent_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS contract_refines (
  crid       INTEGER NOT NULL,
  child_rid  INTEGER NOT NULL,
  parent_rid INTEGER NOT NULL,
  PRIMARY KEY (crid, child_rid, parent_rid),
  FOREIGN KEY (crid, child_rid)  REFERENCES contract_intent(crid, intent_rid),
  FOREIGN KEY (crid, parent_rid) REFERENCES contract_intent(crid, intent_rid),
  CHECK (child_rid <> parent_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS contract_member (  -- clauses, definitions, measures, assumptions, and the claims the contract stands behind
  crid     INTEGER NOT NULL REFERENCES contract_rev(crid),
  rid      INTEGER NOT NULL REFERENCES revision(rid),
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (crid, rid)
) STRICT;

CREATE TABLE IF NOT EXISTS contract_parameter (  -- parameters the contract uses, with the value it sets
  crid          INTEGER NOT NULL REFERENCES contract_rev(crid),
  parameter_rid INTEGER NOT NULL REFERENCES revision(rid),
  value         REAL    NOT NULL,
  PRIMARY KEY (crid, parameter_rid)
) STRICT;

CREATE TABLE IF NOT EXISTS contract_include (    -- composition: nest under one of my intents, or add alongside
  crid             INTEGER NOT NULL REFERENCES contract_rev(crid),
  included_crid    INTEGER NOT NULL REFERENCES contract_rev(crid),
  mode             TEXT    NOT NULL CHECK (mode IN ('nest', 'add')),
  under_intent_rid INTEGER,
  PRIMARY KEY (crid, included_crid),
  FOREIGN KEY (crid, under_intent_rid) REFERENCES contract_intent(crid, intent_rid),
  CHECK ((mode = 'nest') = (under_intent_rid IS NOT NULL)),
  CHECK (included_crid < crid)                   -- only earlier revisions can be included, so cycles are impossible
) STRICT;

-- ─── Integrity triggers ──────────────────────────────────────────────────────

-- Revisions are numbered 1, 2, 3, … per nano and per contract.
CREATE TRIGGER IF NOT EXISTS revision_consecutive BEFORE INSERT ON revision
WHEN NEW.rev <> COALESCE((SELECT MAX(rev) FROM revision WHERE nano_id = NEW.nano_id), 0) + 1
BEGIN SELECT RAISE(ABORT, 'revision numbers must be consecutive per nano'); END;

CREATE TRIGGER IF NOT EXISTS contract_rev_consecutive BEFORE INSERT ON contract_rev
WHEN NEW.rev <> COALESCE((SELECT MAX(rev) FROM contract_rev WHERE contract_id = NEW.contract_id), 0) + 1
BEGIN SELECT RAISE(ABORT, 'revision numbers must be consecutive per contract'); END;

-- A body row must match its revision's kind, and every reference must point at the right kind.
CREATE TRIGGER IF NOT EXISTS intent_body_kind BEFORE INSERT ON intent_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'intent'
BEGIN SELECT RAISE(ABORT, 'intent_body needs an intent revision'); END;

CREATE TRIGGER IF NOT EXISTS clause_body_kind BEFORE INSERT ON clause_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'clause'
BEGIN SELECT RAISE(ABORT, 'clause_body needs a clause revision'); END;

CREATE TRIGGER IF NOT EXISTS definition_body_kind BEFORE INSERT ON definition_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'definition'
BEGIN SELECT RAISE(ABORT, 'definition_body needs a definition revision'); END;

CREATE TRIGGER IF NOT EXISTS parameter_body_kind BEFORE INSERT ON parameter_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'parameter'
BEGIN SELECT RAISE(ABORT, 'parameter_body needs a parameter revision'); END;

CREATE TRIGGER IF NOT EXISTS measure_body_kind BEFORE INSERT ON measure_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'measure'
BEGIN SELECT RAISE(ABORT, 'measure_body needs a measure revision'); END;

CREATE TRIGGER IF NOT EXISTS assumption_body_kind BEFORE INSERT ON assumption_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'assumption'
  OR (NEW.measure_rid IS NOT NULL AND (SELECT kind FROM revision_kind WHERE rid = NEW.measure_rid) IS NOT 'measure')
BEGIN SELECT RAISE(ABORT, 'assumption_body needs an assumption revision, conditioned on a measure'); END;

CREATE TRIGGER IF NOT EXISTS evaluation_body_kind BEFORE INSERT ON evaluation_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'evaluation'
  OR (SELECT kind FROM revision_kind WHERE rid = NEW.measure_rid) IS NOT 'measure'
BEGIN SELECT RAISE(ABORT, 'evaluation_body needs an evaluation revision of a measure'); END;

-- supports / hinders: clause → intent.   conflicts: clause or definition → clause or definition.
CREATE TRIGGER IF NOT EXISTS claim_body_kind BEFORE INSERT ON claim_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'claim'
  OR (NEW.relation IN ('supports', 'hinders') AND (
        (SELECT kind FROM revision_kind WHERE rid = NEW.from_rid) IS NOT 'clause'
     OR (SELECT kind FROM revision_kind WHERE rid = NEW.to_rid)   IS NOT 'intent'))
  OR (NEW.relation = 'conflicts' AND (
        (SELECT kind FROM revision_kind WHERE rid = NEW.from_rid) NOT IN ('clause', 'definition')
     OR (SELECT kind FROM revision_kind WHERE rid = NEW.to_rid)   NOT IN ('clause', 'definition')))
BEGIN SELECT RAISE(ABORT, 'claim ends have the wrong kinds: supports/hinders go clause → intent; conflicts go between clauses or definitions'); END;

CREATE TRIGGER IF NOT EXISTS influence_body_kind BEFORE INSERT ON influence_body
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) IS NOT 'influence'
  OR (SELECT kind FROM revision_kind WHERE rid = NEW.from_rid) IS NOT 'measure'
  OR (SELECT kind FROM revision_kind WHERE rid = NEW.to_rid) NOT IN ('measure', 'intent')
BEGIN SELECT RAISE(ABORT, 'an influence goes from a measure to a measure or an intent'); END;

CREATE TRIGGER IF NOT EXISTS claim_when_kind BEFORE INSERT ON claim_when
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.parameter_rid) IS NOT 'parameter'
BEGIN SELECT RAISE(ABORT, 'claim_when must reference a parameter'); END;

CREATE TRIGGER IF NOT EXISTS claim_assuming_kind BEFORE INSERT ON claim_assuming
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.assumption_rid) IS NOT 'assumption'
BEGIN SELECT RAISE(ABORT, 'claim_assuming must reference an assumption'); END;

CREATE TRIGGER IF NOT EXISTS claim_measure_kind BEFORE INSERT ON claim_measure
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.measure_rid) IS NOT 'measure'
BEGIN SELECT RAISE(ABORT, 'claim_measure must reference a measure'); END;

CREATE TRIGGER IF NOT EXISTS contract_intent_kind BEFORE INSERT ON contract_intent
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.intent_rid) IS NOT 'intent'
BEGIN SELECT RAISE(ABORT, 'contract_intent must reference an intent'); END;

CREATE TRIGGER IF NOT EXISTS contract_member_kind BEFORE INSERT ON contract_member
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.rid) NOT IN ('clause', 'definition', 'measure', 'assumption', 'claim')
BEGIN SELECT RAISE(ABORT, 'contract_member takes clauses, definitions, measures, assumptions and claims; intents go in contract_intent, parameters in contract_parameter'); END;

CREATE TRIGGER IF NOT EXISTS contract_parameter_kind BEFORE INSERT ON contract_parameter
WHEN (SELECT kind FROM revision_kind WHERE rid = NEW.parameter_rid) IS NOT 'parameter'
  OR NEW.value NOT BETWEEN (SELECT min FROM parameter_body WHERE rid = NEW.parameter_rid)
                       AND (SELECT max FROM parameter_body WHERE rid = NEW.parameter_rid)
BEGIN SELECT RAISE(ABORT, 'contract_parameter must reference a parameter, with a value inside its domain'); END;

-- Append-only: nothing that has been written can be changed or removed.
CREATE TRIGGER IF NOT EXISTS revision_immutable_u         BEFORE UPDATE ON revision           BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS revision_immutable_d         BEFORE DELETE ON revision           BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS intent_body_immutable        BEFORE UPDATE ON intent_body        BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS clause_body_immutable        BEFORE UPDATE ON clause_body        BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS definition_body_immutable    BEFORE UPDATE ON definition_body    BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS parameter_body_immutable     BEFORE UPDATE ON parameter_body     BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS measure_body_immutable       BEFORE UPDATE ON measure_body       BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS assumption_body_immutable    BEFORE UPDATE ON assumption_body    BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS claim_body_immutable         BEFORE UPDATE ON claim_body         BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS evaluation_body_immutable    BEFORE UPDATE ON evaluation_body    BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS influence_body_immutable     BEFORE UPDATE ON influence_body     BEGIN SELECT RAISE(ABORT, 'revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS contract_rev_immutable_u     BEFORE UPDATE ON contract_rev       BEGIN SELECT RAISE(ABORT, 'contract revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS contract_rev_immutable_d     BEFORE DELETE ON contract_rev       BEGIN SELECT RAISE(ABORT, 'contract revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS contract_intent_immutable    BEFORE UPDATE ON contract_intent    BEGIN SELECT RAISE(ABORT, 'contract revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS contract_member_immutable    BEFORE UPDATE ON contract_member    BEGIN SELECT RAISE(ABORT, 'contract revisions are immutable: add a new revision'); END;
CREATE TRIGGER IF NOT EXISTS contract_parameter_immutable BEFORE UPDATE ON contract_parameter BEGIN SELECT RAISE(ABORT, 'contract revisions are immutable: add a new revision'); END;

-- ─── Composition ─────────────────────────────────────────────────────────────
-- Composition (membership, claims in scope, disagreements, clashes, influences) is computed by public/compose.mjs from
-- the catalogue, so the server, the static build and the browser share one implementation. The views that used to
-- compute it here are dropped, so the logic isn't kept twice.
DROP VIEW IF EXISTS composition_contract;
DROP VIEW IF EXISTS composition_member;
DROP VIEW IF EXISTS composition_parameter;
DROP VIEW IF EXISTS composition_claim;
DROP VIEW IF EXISTS composition_influence;
DROP VIEW IF EXISTS composition_definition_clash;
DROP VIEW IF EXISTS claim_disagreement;
