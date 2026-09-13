// Snapshot a composition out of the store: everything in scope for one contract, as plain JSON.
// Evaluating a snapshot is pure JavaScript (public/evaluate.mjs), so the server and a static build share one implementation.
import { describe, resolve, resolveContract, nanoId, StoreError } from './store.mjs';
import { evaluate } from '../public/evaluate.mjs';

export { evaluate, jointlyImpossible, compareContexts } from '../public/evaluate.mjs';

export function snapshot(db, contractRef) {
  const crid = resolveContract(db, contractRef);
  const contract = db.prepare(`SELECT c.contract_id AS id, c.rev, c.contract_id || '@' || c.rev AS ref, k.scale, c.title, c.status
                               FROM contract_rev c JOIN contract k ON k.id = c.contract_id WHERE c.crid = ?`).get(crid);
  const cache = new Map();
  const nano = rid => { if (!cache.has(rid)) cache.set(rid, describe(db, rid)); return cache.get(rid); };
  const ref = rid => nano(rid).ref;

  // Every nano in the composition, described, so a client can render labels rather than bare references.
  db.prepare('SELECT rid FROM composition_member WHERE root_crid = ? ORDER BY rid').pluck().all(crid).forEach(nano);

  const parameters = db.prepare('SELECT parameter_rid AS rid, value FROM composition_parameter WHERE root_crid = ?').all(crid)
    .map(({ rid, value }) => ({ ...nano(rid), value }));

  // Claims anywhere in the store that concern this composition, and the pairs among them that disagree.
  const inScope = db.prepare('SELECT claim_rid AS rid, endorsed FROM composition_claim WHERE root_crid = ? ORDER BY claim_rid').all(crid);
  const claims = inScope.map(({ rid, endorsed }) => ({ ...nano(rid), endorsed: Boolean(endorsed) }));
  const scoped = new Set(inScope.map(c => c.rid));
  const disagreements = db.prepare('SELECT claim_a, claim_b FROM claim_disagreement').all()
    .filter(d => scoped.has(d.claim_a) && scoped.has(d.claim_b))
    .map(d => [ref(d.claim_a), ref(d.claim_b)]);
  for (const c of claims) c.measuredBy.forEach(m => nano(resolve(db, m)));

  // Every society's latest observation of each measure the claims mention.
  const measures = new Set(claims.flatMap(c => [...c.measuredBy, ...c.assuming.filter(a => a.condition).map(a => a.condition.measure)].map(nanoId)));
  const observed = db.prepare(`SELECT e.society_id AS society, e.value, e.observed_on AS observedOn, e.source_url AS sourceUrl
                               FROM evaluation_body e JOIN revision m ON m.rid = e.measure_rid
                               WHERE m.nano_id = ? ORDER BY e.observed_on`);
  const observations = {};
  for (const id of measures)
    for (const { society, ...o } of observed.all(id)) (observations[id] ??= {})[society] = o;   // ascending, so the latest wins

  // The intent tree: each contract's own nesting, plus nested includes hung under the includer's intent.
  const intents = [];
  for (const r of db.prepare(`SELECT ci.intent_rid AS rid, ci.combine FROM contract_intent ci
                              JOIN composition_contract cc ON cc.crid = ci.crid AND cc.root_crid = ?
                              ORDER BY cc.depth, ci.crid, ci.position`).all(crid))
    if (!intents.some(i => i.ref === ref(r.rid))) intents.push({ ref: ref(r.rid), combine: r.combine });   // the outermost contract decides
  const edges = db.prepare(`SELECT r.child_rid AS child, r.parent_rid AS parent FROM contract_refines r
                            JOIN composition_contract cc ON cc.crid = r.crid AND cc.root_crid = ?`).all(crid)
    .map(e => ({ child: ref(e.child), parent: ref(e.parent) }));
  const ownRoots = db.prepare(`SELECT intent_rid FROM contract_intent ci WHERE crid = ? AND NOT EXISTS
                               (SELECT 1 FROM contract_refines r WHERE r.crid = ci.crid AND r.child_rid = ci.intent_rid)
                               ORDER BY position`).pluck();
  for (const n of db.prepare(`SELECT i.included_crid, i.under_intent_rid FROM contract_include i
                              JOIN composition_contract cc ON cc.crid = i.crid AND cc.root_crid = ? WHERE i.mode = 'nest'`).all(crid))
    for (const child of ownRoots.all(n.included_crid)) edges.push({ child: ref(child), parent: ref(n.under_intent_rid) });

  const clauses = db.prepare(`SELECT m.rid FROM composition_member m JOIN revision_kind k ON k.rid = m.rid
                              WHERE m.root_crid = ? AND k.kind = 'clause' ORDER BY m.rid`).pluck().all(crid).map(ref);
  const definitionClashes = db.prepare('SELECT term_id AS term, rid_a, rid_b FROM composition_definition_clash WHERE root_crid = ?').all(crid)
    .map(d => ({ term: d.term, definitions: [ref(d.rid_a), ref(d.rid_b)] }));

  return {
    contract, parameters, claims, disagreements, observations, intents, edges, clauses, definitionClashes,
    nanos: Object.fromEntries([...cache.values()].map(n => [n.ref, n])),
  };
}

export function report(db, contractRef, { parameters = {}, society = null } = {}) {
  if (society !== null && !db.prepare('SELECT 1 FROM society WHERE id = ?').get(society))
    throw new StoreError(`no society ${society}`, 404);
  return evaluate(snapshot(db, contractRef), { parameters, society });
}
