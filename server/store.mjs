// The store: open it, resolve references, write and read nano revisions and contracts.
// A reference is `id` (the current revision) or `id@rev` (a pinned revision).
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PATH = fileURLToPath(new URL('../store/composer.sqlite', import.meta.url));
const SCHEMA = readFileSync(new URL('../store/schema.sql', import.meta.url), 'utf8');

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function openStore(path = DEFAULT_PATH, { readonly = false } = {}) {
  const db = new Database(path, { readonly, fileMustExist: readonly });
  db.pragma('foreign_keys = ON');
  if (!readonly) db.exec(SCHEMA);
  return db;
}

// ─── Vocabularies ────────────────────────────────────────────────────────────

const VOCABULARIES = ['author', 'role', 'term', 'unit', 'society'];

export function addVocabulary(db, table, id, label) {
  if (!VOCABULARIES.includes(table)) throw new StoreError(`unknown vocabulary: ${table}`);
  db.prepare(`INSERT INTO ${table} (id, label) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`).run(id, label);
}

// ─── References ──────────────────────────────────────────────────────────────

export function parseRef(ref) {
  const m = /^([a-z0-9.-]+)(?:@(\d+))?$/.exec(String(ref));
  if (!m) throw new StoreError(`not a reference: ${ref} (expected id or id@rev)`);
  return { id: m[1], rev: m[2] ? Number(m[2]) : null };
}

export const nanoId = ref => parseRef(ref).id;

export function resolve(db, ref, kind) {
  const { id, rev } = parseRef(ref);
  const row = rev === null
    ? db.prepare('SELECT rid, kind FROM revision_kind WHERE nano_id = ? ORDER BY rev DESC LIMIT 1').get(id)
    : db.prepare('SELECT rid, kind FROM revision_kind WHERE nano_id = ? AND rev = ?').get(id, rev);
  if (!row) throw new StoreError(`no nano ${ref}`, 404);
  if (kind && row.kind !== kind) throw new StoreError(`${ref} is a ${row.kind}, not a ${kind}`);
  return row.rid;
}

export function resolveContract(db, ref) {
  const { id, rev } = parseRef(ref);
  const crid = rev === null
    ? db.prepare('SELECT crid FROM contract_rev WHERE contract_id = ? ORDER BY rev DESC LIMIT 1').pluck().get(id)
    : db.prepare('SELECT crid FROM contract_rev WHERE contract_id = ? AND rev = ?').pluck().get(id, rev);
  if (crid === undefined) throw new StoreError(`no contract ${ref}`, 404);
  return crid;
}

export function refOf(db, rid) {
  const r = db.prepare('SELECT nano_id, rev FROM revision WHERE rid = ?').get(rid);
  return `${r.nano_id}@${r.rev}`;
}

// ─── Writing nanos ───────────────────────────────────────────────────────────

const WRITE = {
  intent: (db, rid, b) =>
    db.prepare('INSERT INTO intent_body (rid, statement) VALUES (?, ?)').run(rid, b.statement),
  clause: (db, rid, b) =>
    db.prepare('INSERT INTO clause_body (rid, role_id, modality, text) VALUES (?, ?, ?, ?)').run(rid, b.role, b.modality, b.text),
  definition: (db, rid, b) =>
    db.prepare('INSERT INTO definition_body (rid, term_id, meaning) VALUES (?, ?, ?)').run(rid, b.term, b.meaning),
  parameter: (db, rid, b) =>
    db.prepare('INSERT INTO parameter_body (rid, label, unit_id, min, max, meaning) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rid, b.label, b.unit, b.min, b.max, b.meaning),
  measure: (db, rid, b) =>
    db.prepare('INSERT INTO measure_body (rid, label, unit_id, description) VALUES (?, ?, ?, ?)').run(rid, b.label, b.unit, b.description),
  assumption: (db, rid, b) => {
    const c = b.condition;
    db.prepare('INSERT INTO assumption_body (rid, statement, measure_rid, op, value) VALUES (?, ?, ?, ?, ?)')
      .run(rid, b.statement, c ? resolve(db, c.measure, 'measure') : null, c?.op ?? null, c?.value ?? null);
  },
  claim: (db, rid, b) => {
    db.prepare('INSERT INTO claim_body (rid, from_rid, relation, to_rid, strength, rationale) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rid, resolve(db, b.from), b.relation, resolve(db, b.to), b.strength ?? 'contributes', b.rationale);
    for (const ref of b.given ?? [])
      db.prepare('INSERT INTO claim_given (claim_rid, nano_rid) VALUES (?, ?)').run(rid, resolve(db, ref));
    for (const w of b.when ?? [])
      db.prepare('INSERT INTO claim_when (claim_rid, parameter_rid, op, value) VALUES (?, ?, ?, ?)')
        .run(rid, resolve(db, w.parameter, 'parameter'), w.op, w.value);
    for (const ref of b.assuming ?? [])
      db.prepare('INSERT INTO claim_assuming (claim_rid, assumption_rid) VALUES (?, ?)').run(rid, resolve(db, ref, 'assumption'));
    for (const ref of b.measuredBy ?? [])
      db.prepare('INSERT INTO claim_measure (claim_rid, measure_rid) VALUES (?, ?)').run(rid, resolve(db, ref, 'measure'));
  },
  influence: (db, rid, b) =>
    db.prepare('INSERT INTO influence_body (rid, from_rid, direction, to_rid, rationale) VALUES (?, ?, ?, ?, ?)')
      .run(rid, resolve(db, b.from), b.direction, resolve(db, b.to), b.rationale),
  evaluation: (db, rid, b) =>
    db.prepare('INSERT INTO evaluation_body (rid, measure_rid, society_id, value, observed_on, source_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rid, resolve(db, b.measure, 'measure'), b.society, b.value, b.observedOn, b.sourceUrl),
};

// Add a revision of a nano (revision 1 creates the nano). Returns { ref, rid }.
export function addNano(db, { id, kind, filedBy, source, ...body }) {
  const write = WRITE[kind];
  if (!write) throw new StoreError(`unknown kind: ${kind}`);
  return db.transaction(() => {
    const existing = db.prepare('SELECT kind FROM nano WHERE id = ?').pluck().get(id);
    if (existing && existing !== kind) throw new StoreError(`${id} is already a ${existing}`);
    if (!existing) db.prepare('INSERT INTO nano (id, kind) VALUES (?, ?)').run(id, kind);
    const rev = db.prepare('SELECT COALESCE(MAX(rev), 0) + 1 FROM revision WHERE nano_id = ?').pluck().get(id);
    const rid = Number(db.prepare('INSERT INTO revision (nano_id, rev, filed_by, source) VALUES (?, ?, ?, ?)')
      .run(id, rev, filedBy, source).lastInsertRowid);
    write(db, rid, body);
    return { ref: `${id}@${rev}`, rid };
  })();
}

// Add a revision of a contract (revision 1 creates the contract). Returns { ref, crid }.
//   intents:    [{ ref, combine?: 'all'|'any', parent?: ref | ref[] }]   — the intent tree, in order
//   members:    [ref]                                                     — clauses, definitions, measures, assumptions, endorsed claims
//   parameters: { ref: value }
//   includes:   [{ contract: ref, mode: 'nest'|'add', under?: intent ref }]
export function addContract(db, { id, scale, title, status = 'draft', filedBy, source,
                                  intents = [], members = [], parameters = {}, includes = [] }) {
  return db.transaction(() => {
    const existing = db.prepare('SELECT scale FROM contract WHERE id = ?').pluck().get(id);
    if (existing && existing !== scale) throw new StoreError(`${id} is already a ${existing} contract`);
    if (!existing) db.prepare('INSERT INTO contract (id, scale) VALUES (?, ?)').run(id, scale);
    const rev = db.prepare('SELECT COALESCE(MAX(rev), 0) + 1 FROM contract_rev WHERE contract_id = ?').pluck().get(id);
    const crid = Number(db.prepare('INSERT INTO contract_rev (contract_id, rev, title, status, filed_by, source) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, rev, title, status, filedBy, source).lastInsertRowid);

    const intentRid = new Map();
    intents.forEach((it, position) => {
      const rid = resolve(db, it.ref, 'intent');
      intentRid.set(it.ref, rid);
      db.prepare('INSERT INTO contract_intent (crid, intent_rid, combine, position) VALUES (?, ?, ?, ?)')
        .run(crid, rid, it.combine ?? 'all', position);
    });
    const ownIntent = ref => {
      const rid = intentRid.get(ref);
      if (rid === undefined) throw new StoreError(`${ref} is not an intent of ${id}`);
      return rid;
    };
    for (const it of intents)
      for (const parent of [it.parent ?? []].flat())
        db.prepare('INSERT INTO contract_refines (crid, child_rid, parent_rid) VALUES (?, ?, ?)').run(crid, intentRid.get(it.ref), ownIntent(parent));
    members.forEach((ref, position) =>
      db.prepare('INSERT INTO contract_member (crid, rid, position) VALUES (?, ?, ?)').run(crid, resolve(db, ref), position));
    for (const [ref, value] of Object.entries(parameters))
      db.prepare('INSERT INTO contract_parameter (crid, parameter_rid, value) VALUES (?, ?, ?)').run(crid, resolve(db, ref, 'parameter'), value);
    for (const inc of includes)
      db.prepare('INSERT INTO contract_include (crid, included_crid, mode, under_intent_rid) VALUES (?, ?, ?, ?)')
        .run(crid, resolveContract(db, inc.contract), inc.mode, inc.under ? ownIntent(inc.under) : null);
    return { ref: `${id}@${rev}`, crid };
  })();
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const READ = {
  intent: (db, rid) => db.prepare('SELECT statement FROM intent_body WHERE rid = ?').get(rid),
  clause: (db, rid) => db.prepare(`SELECT b.role_id AS role, r.label AS roleLabel, b.modality, b.text
                                   FROM clause_body b JOIN role r ON r.id = b.role_id WHERE b.rid = ?`).get(rid),
  definition: (db, rid) => db.prepare(`SELECT b.term_id AS term, t.label AS termLabel, b.meaning
                                       FROM definition_body b JOIN term t ON t.id = b.term_id WHERE b.rid = ?`).get(rid),
  parameter: (db, rid) => db.prepare(`SELECT b.label, b.unit_id AS unit, u.label AS unitLabel, b.min, b.max, b.meaning
                                      FROM parameter_body b JOIN unit u ON u.id = b.unit_id WHERE b.rid = ?`).get(rid),
  measure: (db, rid) => db.prepare(`SELECT b.label, b.unit_id AS unit, u.label AS unitLabel, b.description
                                    FROM measure_body b JOIN unit u ON u.id = b.unit_id WHERE b.rid = ?`).get(rid),
  assumption: (db, rid) => {
    const a = db.prepare('SELECT statement, measure_rid, op, value FROM assumption_body WHERE rid = ?').get(rid);
    return { statement: a.statement,
             condition: a.measure_rid === null ? null : { measure: refOf(db, a.measure_rid), op: a.op, value: a.value } };
  },
  claim: (db, rid) => {
    const c = db.prepare('SELECT from_rid, relation, to_rid, strength, rationale FROM claim_body WHERE rid = ?').get(rid);
    return {
      from: refOf(db, c.from_rid), relation: c.relation, to: refOf(db, c.to_rid), strength: c.strength, rationale: c.rationale,
      given: db.prepare('SELECT nano_rid FROM claim_given WHERE claim_rid = ?').pluck().all(rid).map(r => refOf(db, r)),
      when: db.prepare('SELECT parameter_rid, op, value FROM claim_when WHERE claim_rid = ?').all(rid)
        .map(w => ({ parameter: refOf(db, w.parameter_rid), op: w.op, value: w.value })),
      assuming: db.prepare('SELECT assumption_rid FROM claim_assuming WHERE claim_rid = ?').pluck().all(rid)
        .map(a => ({ ref: refOf(db, a), ...READ.assumption(db, a) })),
      measuredBy: db.prepare('SELECT measure_rid FROM claim_measure WHERE claim_rid = ?').pluck().all(rid).map(r => refOf(db, r)),
    };
  },
  influence: (db, rid) => {
    const i = db.prepare('SELECT from_rid, direction, to_rid, rationale FROM influence_body WHERE rid = ?').get(rid);
    return { from: refOf(db, i.from_rid), direction: i.direction, to: refOf(db, i.to_rid), rationale: i.rationale };
  },
  evaluation: (db, rid) => {
    const e = db.prepare('SELECT measure_rid, society_id, value, observed_on, source_url FROM evaluation_body WHERE rid = ?').get(rid);
    return { measure: refOf(db, e.measure_rid), society: e.society_id, value: e.value, observedOn: e.observed_on, sourceUrl: e.source_url };
  },
};

// Everything about one nano revision, with references rendered as `id@rev`.
export function describe(db, rid) {
  const r = db.prepare(`SELECT r.rid, r.nano_id AS id, r.rev, n.kind, r.filed_by AS filedBy, r.source, r.created_at AS createdAt
                        FROM revision r JOIN nano n ON n.id = r.nano_id WHERE r.rid = ?`).get(rid);
  if (!r) throw new StoreError(`no nano revision ${rid}`, 404);
  return { ref: `${r.id}@${r.rev}`, ...r, ...READ[r.kind](db, rid) };
}

export function listContracts(db) {
  return db.prepare(`SELECT c.contract_id AS id, c.rev, c.contract_id || '@' || c.rev AS ref, k.scale, c.title, c.status
                     FROM contract_rev c JOIN contract k ON k.id = c.contract_id
                     WHERE c.rev = (SELECT MAX(rev) FROM contract_rev x WHERE x.contract_id = c.contract_id)
                     ORDER BY k.scale DESC, c.title`).all();
}
