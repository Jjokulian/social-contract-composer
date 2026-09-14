// The store: open it, resolve references, write and read nano revisions and contracts.
// A reference is `id` (the current revision) or `id@rev` (a pinned revision).
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkSegment } from '../public/space.mjs';

export const DEFAULT_PATH = fileURLToPath(new URL('../store/composer.sqlite', import.meta.url));
// The platform's own structure (its vocabulary, and in time its requirements and deployments), in the same schema.
export const SYSTEM_PATH = fileURLToPath(new URL('../store/system.sqlite', import.meta.url));
const SCHEMA = readFileSync(new URL('../store/schema.sql', import.meta.url), 'utf8');

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function openStore(path = DEFAULT_PATH, { readonly = false } = {}) {
  const db = new Database(path, { readonly, fileMustExist: readonly });
  db.pragma('foreign_keys = ON');
  if (!readonly) { db.exec(SCHEMA); migrate(db); }
  return db;
}

// Columns added after a store was first created. Adding a column changes no existing revision's content.
function migrate(db) {
  const columns = db.prepare('PRAGMA table_info(clause_body)').all().map(c => c.name);
  if (!columns.includes('binding')) db.exec("ALTER TABLE clause_body ADD COLUMN binding TEXT CHECK (binding IN ('work', 'abide', 'liberty'))");
  if (!db.prepare('PRAGMA table_info(contract_include)').all().some(c => c.name === 'base'))
    db.exec('ALTER TABLE contract_include ADD COLUMN base INTEGER NOT NULL DEFAULT 0 CHECK (base IN (0, 1))');
  // A contract can hold units of software: recreate the member-kind check where it predates them.
  const memberKinds = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'contract_member_kind'").pluck().get();
  if (memberKinds && !memberKinds.includes("'unit'")) { db.exec('DROP TRIGGER contract_member_kind'); db.exec(SCHEMA); }
}

// What a clause binds its role to, when the clause doesn't state it: follows the modality.
const BINDING_OF_MODALITY = { 'shall': 'work', 'shall not': 'abide', 'may': 'liberty' };

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

const contractRefOf = (db, crid) => db.prepare("SELECT contract_id || '@' || rev FROM contract_rev WHERE crid = ?").pluck().get(crid);

// A contract revision's operators, in order, with references rendered as `id@rev` (fields that don't apply are left out).
function operationsOf(db, crid) {
  return db.prepare('SELECT op, contract_crid, nano_rid, replacement_rid, cites_rid FROM contract_operation WHERE crid = ? ORDER BY position')
    .all(crid)
    .map(o => Object.fromEntries(Object.entries({
      op: o.op,
      contract: o.contract_crid === null ? null : contractRefOf(db, o.contract_crid),
      nano: o.nano_rid === null ? null : refOf(db, o.nano_rid),
      replacement: o.replacement_rid === null ? null : refOf(db, o.replacement_rid),
      cites: o.cites_rid === null ? null : refOf(db, o.cites_rid),
    }).filter(([, v]) => v !== null)));
}

// ─── Writing nanos ───────────────────────────────────────────────────────────

const WRITE = {
  intent: (db, rid, b) =>
    db.prepare('INSERT INTO intent_body (rid, statement) VALUES (?, ?)').run(rid, b.statement),
  clause: (db, rid, b) =>
    db.prepare('INSERT INTO clause_body (rid, role_id, modality, text, binding) VALUES (?, ?, ?, ?, ?)')
      .run(rid, b.role, b.modality, b.text, b.binding ?? null),
  definition: (db, rid, b) => {   // a pico, with the forms that refer to it
    db.prepare('INSERT INTO definition_body (rid, term_id, meaning) VALUES (?, ?, ?)').run(rid, b.term, b.meaning);
    for (const form of b.forms ?? []) db.prepare('INSERT INTO definition_form (rid, form) VALUES (?, ?)').run(rid, form);
  },
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
  consequence: (db, rid, b) =>
    db.prepare('INSERT INTO consequence_body (rid, statement) VALUES (?, ?)').run(rid, b.statement),
  unit: (db, rid, b) => {   // a unit of the platform's software, with what it imports and uses
    db.prepare('INSERT INTO unit_body (rid, form, name, language, text) VALUES (?, ?, ?, ?, ?)').run(rid, b.form, b.name ?? null, b.language, b.text);
    for (const d of b.depends ?? [])
      db.prepare('INSERT INTO unit_depends (rid, target_id, relation) VALUES (?, ?, ?)').run(rid, d.id, d.relation);
  },
  evaluation: (db, rid, b) =>
    db.prepare('INSERT INTO evaluation_body (rid, measure_rid, society_id, value, observed_on, source_url) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rid, resolve(db, b.measure, 'measure'), b.society, b.value, b.observedOn, b.sourceUrl),
};

// The field that holds a nano's words, per kind: where its picos are referred to.
export const TEXT_FIELD = { intent: 'statement', clause: 'text', definition: 'meaning', claim: 'rationale', assumption: 'statement',
                            influence: 'rationale', consequence: 'statement', measure: 'description', parameter: 'meaning',
                            unit: 'text' };

// Add a revision of a nano (revision 1 creates the nano). Returns { ref, rid }.
//   picos: [{ phrase, pico }] — the phrases in its text that refer to which pico revisions, fixed with this revision.
//          tools/picos.mjs suggests them from the picos' forms.
//   implementedBy: [unit id] — for the platform's own store: the units of software that implement this pico or nano.
export function addNano(db, { id, kind, filedBy, source, picos = [], implementedBy = [], ...body }) {
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
    const text = String(body[TEXT_FIELD[kind]] ?? '').toLowerCase();
    for (const { phrase, pico } of picos) {
      if (!text.includes(phrase.toLowerCase())) throw new StoreError(`“${phrase}” does not occur in the text of ${id}`);
      db.prepare('INSERT INTO nano_pico (rid, phrase, pico_rid) VALUES (?, ?, ?)').run(rid, phrase, resolve(db, pico, 'definition'));
    }
    for (const unit of new Set(implementedBy)) db.prepare('INSERT INTO nano_implementation (rid, unit_id) VALUES (?, ?)').run(rid, unit);
    return { ref: `${id}@${rev}`, rid };
  })();
}

// Add a revision of a contract (revision 1 creates the contract). Returns { ref, crid }.
//   intents:    [{ ref, combine?: 'all'|'any', parent?: ref | ref[] }]   — the intent tree, in order
//   members:    [ref]                                                     — clauses, definitions, measures, assumptions, endorsed claims
//   parameters: { ref: value }
//   includes:   [{ contract: ref, mode: 'nest'|'add', under?: intent ref }]
export function addContract(db, { id, scale, title, status = 'draft', filedBy, source,
                                  intents = [], members = [], parameters = {}, includes = [], breaches = [], enforcement = [],
                                  socioship = [], operations = [], resolution = [], specialis = [] }) {
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
      db.prepare('INSERT INTO contract_include (crid, included_crid, mode, under_intent_rid, base) VALUES (?, ?, ?, ?, ?)')
        .run(crid, resolveContract(db, inc.contract), inc.mode, inc.under ? ownIntent(inc.under) : null, inc.base ? 1 : 0);
    for (const b of breaches)   // consequences of breach, set by this composition
      db.prepare('INSERT INTO contract_breach (crid, clause_rid, consequence_rid) VALUES (?, ?, ?)')
        .run(crid, resolve(db, b.clause, 'clause'), resolve(db, b.consequence, 'consequence'));
    for (const e of enforcement)   // who detects breaches and applies consequences, set by this composition
      db.prepare('INSERT INTO contract_enforcement (crid, clause_rid, role_id) VALUES (?, ?, ?)').run(crid, resolve(db, e.clause, 'clause'), e.by);
    for (const s of socioship)   // for a milli: which of its clauses or definitions define each term of its socioship
      db.prepare('INSERT INTO contract_socioship (crid, term_id, nano_rid) VALUES (?, ?, ?)').run(crid, s.term, resolve(db, s.nano));
    operations.forEach((o, position) =>   // abrogate / derogate / subrogate / obrogate what it includes
      db.prepare(`INSERT INTO contract_operation (crid, position, op, contract_crid, nano_rid, replacement_rid, cites_rid)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(crid, position, o.op, o.contract ? resolveContract(db, o.contract) : null, o.nano ? resolve(db, o.nano) : null,
             o.replacement ? resolve(db, o.replacement) : null, o.cites ? resolve(db, o.cites) : null));
    resolution.forEach((maxim, position) =>   // the maxims that resolve conflicts, in order
      db.prepare('INSERT INTO contract_resolution (crid, position, maxim) VALUES (?, ?, ?)').run(crid, position, maxim));
    for (const s of specialis)
      db.prepare('INSERT INTO contract_specialis (crid, special_rid, general_rid) VALUES (?, ?, ?)').run(crid, resolve(db, s.special), resolve(db, s.general));
    return { ref: `${id}@${rev}`, crid };
  })();
}

// Add the next revision of a contract, derived from its current one, so a change never restates the whole contract.
//   replace:    { oldRef: newRef }   — swaps any intent, member, parameter or nesting reference
//   add / drop: [ref]                — members to add, or (by their current reference) to drop
//   addIntents: [{ ref, combine?, parent? }]
//   dropEdges:  [{ child, parent }]                                     — refinements to remove, by current references
export function reviseContract(db, id, { replace = {}, add = [], drop = [], addIntents = [], dropEdges = [], addBreaches = [], addEnforcement = [],
                                         addSocioship = [], addOperations = [], resolution: newResolution, addSpecialis = [],
                                         filedBy, source, title, status } = {}) {
  const crid = resolveContract(db, id);
  const current = db.prepare(`SELECT c.contract_id AS id, c.title, c.status, k.scale FROM contract_rev c
                               JOIN contract k ON k.id = c.contract_id WHERE c.crid = ?`).get(crid);
  const swap = ref => replace[ref] ?? ref;
  const parents = new Map();
  for (const r of db.prepare('SELECT child_rid, parent_rid FROM contract_refines WHERE crid = ?').all(crid)) {
    const child = refOf(db, r.child_rid), parent = refOf(db, r.parent_rid);
    if (dropEdges.some(e => e.child === child && e.parent === parent)) continue;
    parents.set(child, [...(parents.get(child) ?? []), swap(parent)]);
  }
  const intents = db.prepare('SELECT intent_rid, combine FROM contract_intent WHERE crid = ? ORDER BY position').all(crid)
    .map(i => { const ref = refOf(db, i.intent_rid); return { ref: swap(ref), combine: i.combine, parent: parents.get(ref) ?? [] }; });
  const members = db.prepare('SELECT rid FROM contract_member WHERE crid = ? ORDER BY position').pluck().all(crid)
    .map(rid => refOf(db, rid)).filter(ref => !drop.includes(ref)).map(swap);
  const parameters = Object.fromEntries(db.prepare('SELECT parameter_rid, value FROM contract_parameter WHERE crid = ?').all(crid)
    .map(p => [swap(refOf(db, p.parameter_rid)), p.value]));
  const includes = db.prepare('SELECT included_crid, mode, under_intent_rid, base FROM contract_include WHERE crid = ?').all(crid)
    .map(i => ({
      contract: swap(contractRefOf(db, i.included_crid)), base: i.base === 1,
      mode: i.mode, under: i.under_intent_rid === null ? undefined : swap(refOf(db, i.under_intent_rid)),
    }));
  const operations = operationsOf(db, crid).map(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'op' ? v : swap(v)])));
  const resolution = newResolution ?? db.prepare('SELECT maxim FROM contract_resolution WHERE crid = ? ORDER BY position').pluck().all(crid);
  const specialis = db.prepare('SELECT special_rid, general_rid FROM contract_specialis WHERE crid = ?').all(crid)
    .map(s => ({ special: swap(refOf(db, s.special_rid)), general: swap(refOf(db, s.general_rid)) }));
  const breaches = db.prepare('SELECT clause_rid, consequence_rid FROM contract_breach WHERE crid = ?').all(crid)
    .map(b => ({ clause: swap(refOf(db, b.clause_rid)), consequence: swap(refOf(db, b.consequence_rid)) }));
  return addContract(db, {
    id: current.id, scale: current.scale, title: title ?? current.title, status: status ?? current.status, filedBy, source,
    intents: mergeIntents(intents, addIntents), members: [...members, ...add], parameters, includes,
    breaches: [...breaches, ...addBreaches],
    enforcement: [
      ...db.prepare('SELECT clause_rid, role_id FROM contract_enforcement WHERE crid = ?').all(crid)
        .map(e => ({ clause: swap(refOf(db, e.clause_rid)), by: e.role_id })),
      ...addEnforcement,
    ],
    socioship: [
      ...db.prepare('SELECT term_id, nano_rid FROM contract_socioship WHERE crid = ?').all(crid)
        .map(s => ({ term: s.term_id, nano: swap(refOf(db, s.nano_rid)) })),
      ...addSocioship,
    ],
    operations: [...operations, ...addOperations], resolution, specialis: [...specialis, ...addSpecialis],
  });
}

// An intent already in the contract keeps its place and gains the added parents; a new intent is appended.
function mergeIntents(intents, additions) {
  const merged = intents.map(i => ({ ...i, parent: [i.parent ?? []].flat() }));
  for (const it of additions) {
    const extra = [it.parent ?? []].flat();
    const existing = merged.find(i => i.ref === it.ref);
    if (existing) existing.parent = [...new Set([...existing.parent, ...extra])];
    else merged.push({ ref: it.ref, combine: it.combine ?? 'all', parent: extra });
  }
  return merged;
}

// ─── Demesnes ────────────────────────────────────────────────────────────────

// Add a revision of a demesne (revision 1 creates it): a milli, implemented on a segment of a coordinate space.
//   milli:   the milli's revision, e.g. 'town@1' (a micro is refused: it is composed into a milli first)
//   segment: a GeoJSON Polygon or MultiPolygon in the space's frame
export function addDemesne(db, { id, name, milli, space, segment, filedBy, source }) {
  checkSegment(segment);
  return db.transaction(() => {
    db.prepare('INSERT INTO demesne (id) VALUES (?) ON CONFLICT (id) DO NOTHING').run(id);
    const rev = db.prepare('SELECT COALESCE(MAX(rev), 0) + 1 FROM demesne_rev WHERE demesne_id = ?').pluck().get(id);
    db.prepare('INSERT INTO demesne_rev (demesne_id, rev, name, crid, space_id, segment, filed_by, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, rev, name, resolveContract(db, milli), space, JSON.stringify(segment), filedBy, source);
    return { ref: `${id}@${rev}` };
  })();
}

// Every demesne revision, and the coordinate spaces. public/space.mjs computes how they nest and the layers to view.
export function listDemesnes(db) {
  const spaces = db.prepare('SELECT id, label, frame FROM space ORDER BY label').all();
  const demesnes = db.prepare(`SELECT d.demesne_id AS id, d.rev, d.demesne_id || '@' || d.rev AS ref, d.name, d.space_id AS space,
                                      c.contract_id || '@' || c.rev AS milli, c.title AS milliTitle, d.segment,
                                      d.filed_by AS filedBy, d.source
                               FROM demesne_rev d JOIN contract_rev c ON c.crid = d.crid ORDER BY d.drid`).all()
    .map(d => ({ ...d, segment: JSON.parse(d.segment) }));
  return { spaces, demesnes };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const READ = {
  intent: (db, rid) => db.prepare('SELECT statement FROM intent_body WHERE rid = ?').get(rid),
  clause: (db, rid) => {
    const { binding, ...c } = db.prepare(`SELECT b.role_id AS role, r.label AS roleLabel, b.modality, b.text, b.binding
                                          FROM clause_body b JOIN role r ON r.id = b.role_id WHERE b.rid = ?`).get(rid);
    return { ...c, binding: binding ?? BINDING_OF_MODALITY[c.modality], bindingStated: binding !== null };
  },
  definition: (db, rid) => {
    const d = db.prepare(`SELECT b.term_id AS term, t.label AS termLabel, b.meaning
                          FROM definition_body b JOIN term t ON t.id = b.term_id WHERE b.rid = ?`).get(rid);
    const forms = db.prepare('SELECT form FROM definition_form WHERE rid = ? ORDER BY form').pluck().all(rid);
    return { ...d, forms: forms.length ? forms : [d.termLabel] };
  },
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
  consequence: (db, rid) => db.prepare('SELECT statement FROM consequence_body WHERE rid = ?').get(rid),
  unit: (db, rid) => ({
    ...db.prepare('SELECT form, name, language, text FROM unit_body WHERE rid = ?').get(rid),
    depends: db.prepare('SELECT target_id AS id, relation FROM unit_depends WHERE rid = ? ORDER BY target_id, relation').all(rid),
  }),
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
  const picos = db.prepare('SELECT phrase, pico_rid FROM nano_pico WHERE rid = ? ORDER BY phrase').all(rid)
    .map(p => ({ phrase: p.phrase, pico: refOf(db, p.pico_rid) }));
  const implementedBy = db.prepare('SELECT unit_id FROM nano_implementation WHERE rid = ? ORDER BY unit_id').pluck().all(rid);
  return { ref: `${r.id}@${r.rev}`, ...r, ...READ[r.kind](db, rid), picos, ...(implementedBy.length && { implementedBy }) };
}

// The whole store as plain JSON: every nano revision, every contract revision's structure, and every society's
// latest observation of each measure. public/compose.mjs composes snapshots from it, on the server and in the browser.
export function catalogue(db) {
  const nanos = Object.fromEntries(db.prepare('SELECT rid FROM revision ORDER BY rid').pluck().all()
    .map(rid => { const n = describe(db, rid); return [n.ref, n]; }));
  const contracts = {};
  for (const c of db.prepare(`SELECT c.crid, c.contract_id AS id, c.rev, c.contract_id || '@' || c.rev AS ref, k.scale, c.title, c.status, c.source
                              FROM contract_rev c JOIN contract k ON k.id = c.contract_id ORDER BY c.crid`).all()) {
    c.intents = db.prepare('SELECT intent_rid, combine FROM contract_intent WHERE crid = ? ORDER BY position').all(c.crid)
      .map(i => ({ ref: refOf(db, i.intent_rid), combine: i.combine }));
    // Children in the order the contract places its intents, never in storage order (a rewritten intent is a newer row).
    c.edges = db.prepare(`SELECT r.child_rid, r.parent_rid FROM contract_refines r
                          JOIN contract_intent i ON i.crid = r.crid AND i.intent_rid = r.child_rid
                          WHERE r.crid = ? ORDER BY i.position, r.parent_rid`).all(c.crid)
      .map(e => ({ child: refOf(db, e.child_rid), parent: refOf(db, e.parent_rid) }));
    c.members = db.prepare('SELECT rid FROM contract_member WHERE crid = ? ORDER BY position').pluck().all(c.crid).map(rid => refOf(db, rid));
    c.parameters = Object.fromEntries(db.prepare('SELECT parameter_rid, value FROM contract_parameter WHERE crid = ?').all(c.crid)
      .map(p => [refOf(db, p.parameter_rid), p.value]));
    c.includes = db.prepare(`SELECT r.contract_id || '@' || r.rev AS ref, i.mode, i.under_intent_rid, i.base FROM contract_include i
                             JOIN contract_rev r ON r.crid = i.included_crid WHERE i.crid = ? ORDER BY r.crid`).all(c.crid)
      .map(i => ({ ref: i.ref, mode: i.mode, base: i.base === 1, under: i.under_intent_rid === null ? null : refOf(db, i.under_intent_rid) }));
    c.breaches = db.prepare('SELECT clause_rid, consequence_rid FROM contract_breach WHERE crid = ? ORDER BY clause_rid, consequence_rid').all(c.crid)
      .map(b => ({ clause: refOf(db, b.clause_rid), consequence: refOf(db, b.consequence_rid) }));
    c.enforcement = db.prepare('SELECT clause_rid, role_id FROM contract_enforcement WHERE crid = ? ORDER BY clause_rid, role_id').all(c.crid)
      .map(e => ({ clause: refOf(db, e.clause_rid), by: e.role_id }));
    c.socioship = db.prepare('SELECT term_id, nano_rid FROM contract_socioship WHERE crid = ? ORDER BY term_id, nano_rid').all(c.crid)
      .map(s => ({ term: s.term_id, nano: refOf(db, s.nano_rid) }));
    c.operations = operationsOf(db, c.crid);
    c.resolution = db.prepare('SELECT maxim FROM contract_resolution WHERE crid = ? ORDER BY position').pluck().all(c.crid);
    c.specialis = db.prepare('SELECT special_rid, general_rid FROM contract_specialis WHERE crid = ? ORDER BY special_rid, general_rid').all(c.crid)
      .map(s => ({ special: refOf(db, s.special_rid), general: refOf(db, s.general_rid) }));
    contracts[c.ref] = c;
  }
  const roles = db.prepare('SELECT id, label FROM role ORDER BY label').all();
  const observations = {};
  for (const { measure, society, ...o } of db.prepare(`SELECT m.nano_id AS measure, e.society_id AS society, e.value,
                                                              e.observed_on AS observedOn, e.source_url AS sourceUrl
                                                       FROM evaluation_body e JOIN revision m ON m.rid = e.measure_rid
                                                       ORDER BY e.observed_on, e.rid`).all())
    (observations[measure] ??= {})[society] = o;   // ascending, so the latest wins
  const societies = db.prepare('SELECT id, label FROM society ORDER BY label').all();
  // Socioship is structure: the terms every milli defines, in order.
  const socioshipTerms = db.prepare('SELECT id, label, asks, default_rule AS defaultRule FROM socioship_term ORDER BY position').all();
  return { nanos, contracts, observations, societies, roles, socioshipTerms, ...listDemesnes(db) };
}

export function listContracts(db) {
  return db.prepare(`SELECT c.contract_id AS id, c.rev, c.contract_id || '@' || c.rev AS ref, k.scale, c.title, c.status, c.source
                     FROM contract_rev c JOIN contract k ON k.id = c.contract_id
                     WHERE c.rev = (SELECT MAX(rev) FROM contract_rev x WHERE x.contract_id = c.contract_id)
                       AND c.status <> 'retired'   -- a retired contract stays in the catalogue and its history, but leaves the list
                     ORDER BY k.scale DESC, c.title`).all();
}
