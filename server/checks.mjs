// The composition report: what a composition claims to satisfy, where its claims pull apart, and why.
// The SQL views decide membership and scope; this module evaluates conditions and rolls intents up.
// Every step is one pass over the graph or a pairwise comparison. Nothing here searches.
import { describe, resolveContract, nanoId, StoreError } from './store.mjs';

const HOLDS = {
  '<': (x, v) => x < v, '<=': (x, v) => x <= v,
  '>': (x, v) => x > v, '>=': (x, v) => x >= v,
  '=': (x, v) => x === v,
};

// Are these conditions on one quantity jointly impossible? Interval intersection, not search.
export function jointlyImpossible(conditions) {
  let lo = -Infinity, loIn = true, hi = Infinity, hiIn = true;
  for (const { op, value } of conditions) {
    if (op === '>' || op === '>=' || op === '=') {
      const inclusive = op !== '>';
      if (value > lo) { lo = value; loIn = inclusive; } else if (value === lo) loIn = loIn && inclusive;
    }
    if (op === '<' || op === '<=' || op === '=') {
      const inclusive = op !== '<';
      if (value < hi) { hi = value; hiIn = inclusive; } else if (value === hi) hiIn = hiIn && inclusive;
    }
  }
  return lo > hi || (lo === hi && !(loIn && hiIn));
}

const split = (a, b) => ({
  shared: a.filter(x => b.includes(x)),
  onlyA: a.filter(x => !b.includes(x)),
  onlyB: b.filter(x => !a.includes(x)),
});

// Where two claims that reach different conclusions part ways.
export function compareContexts(a, b) {
  const whenKey = w => `${w.parameter} ${w.op} ${w.value}`;
  const given = split(a.given, b.given);
  const when = split(a.when.map(whenKey), b.when.map(whenKey));
  const assuming = split(a.assuming.map(x => x.ref), b.assuming.map(x => x.ref));

  const cruxes = (pick) => {
    const byQuantity = new Map();
    for (const [side, claim] of [['a', a], ['b', b]])
      for (const { quantity, op, value } of pick(claim)) {
        const entry = byQuantity.get(quantity) ?? { a: [], b: [] };
        entry[side].push({ op, value });
        byQuantity.set(quantity, entry);
      }
    return [...byQuantity].filter(([, e]) => e.a.length && e.b.length && jointlyImpossible([...e.a, ...e.b]))
      .map(([quantity, e]) => ({ quantity, a: e.a, b: e.b }));
  };
  const parameterCruxes = cruxes(c => c.when.map(w => ({ quantity: nanoId(w.parameter), op: w.op, value: w.value })));
  const measureCruxes = cruxes(c => c.assuming.filter(x => x.condition)
    .map(x => ({ quantity: nanoId(x.condition.measure), op: x.condition.op, value: x.condition.value })));

  const identical = [given, when, assuming].every(s => !s.onlyA.length && !s.onlyB.length);
  const kind = parameterCruxes.length ? 'conditional'
    : measureCruxes.length ? 'crux-on-assumption'
    : identical ? 'direct'
    : 'divergent-context';
  const settledBy = {
    'conditional': `nothing to settle: both hold, at different values of ${parameterCruxes.map(c => c.quantity).join(', ')}`,
    'crux-on-assumption': `an evaluation of ${measureCruxes.map(c => c.quantity).join(', ')} in the adopting society`,
    'direct': 'debate about the reasoning and evidence: the contexts are identical',
    'divergent-context': 'whether the context only one claim considers belongs in the picture',
  }[kind];
  return { kind, settledBy, given, when, assuming, parameterCruxes, measureCruxes };
}

const LEVELS = ['gap', 'thin', 'claimed'];

export function report(db, contractRef, { parameters: overrides = {}, society = null } = {}) {
  const crid = resolveContract(db, contractRef);
  const contract = db.prepare(`SELECT c.contract_id AS id, c.rev, c.contract_id || '@' || c.rev AS ref, k.scale, c.title, c.status
                               FROM contract_rev c JOIN contract k ON k.id = c.contract_id WHERE c.crid = ?`).get(crid);
  if (society !== null && !db.prepare('SELECT 1 FROM society WHERE id = ?').get(society))
    throw new StoreError(`no society ${society}`, 404);

  const cache = new Map();
  const nano = rid => { if (!cache.has(rid)) cache.set(rid, describe(db, rid)); return cache.get(rid); };

  // Parameters: the composition's values, optionally overridden to explore alternatives.
  const parameters = db.prepare('SELECT parameter_rid AS rid, value FROM composition_parameter WHERE root_crid = ?').all(crid)
    .map(({ rid, value }) => {
      const p = nano(rid);
      const override = overrides[p.id] ?? overrides[p.ref];
      if (override === undefined) return { ...p, value, contractValue: value, overridden: false };
      const v = Number(override);
      if (!(v >= p.min && v <= p.max)) throw new StoreError(`${p.label} must be between ${p.min} and ${p.max} ${p.unitLabel}`);
      return { ...p, value: v, contractValue: value, overridden: v !== value };
    });
  const parameterValue = new Map(parameters.map(p => [p.id, p.value]));

  // Claims in scope, with their conditions evaluated.
  const observation = db.prepare(`SELECT e.value, e.observed_on AS observedOn, e.source_url AS sourceUrl
                                  FROM evaluation_body e JOIN revision m ON m.rid = e.measure_rid
                                  WHERE m.nano_id = ? AND e.society_id = ? ORDER BY e.observed_on DESC LIMIT 1`);
  const claims = db.prepare('SELECT claim_rid AS rid, endorsed FROM composition_claim WHERE root_crid = ?').all(crid)
    .map(({ rid, endorsed }) => {
      const c = nano(rid);
      const when = c.when.map(w => {
        const current = parameterValue.get(nanoId(w.parameter));
        return { ...w, current: current ?? null, holds: current !== undefined && HOLDS[w.op](current, w.value) };
      });
      const assuming = c.assuming.map(a => {
        const observed = a.condition && society ? observation.get(nanoId(a.condition.measure), society) : undefined;
        if (!observed) return { ...a, status: 'unverified' };
        return { ...a, observed, status: HOLDS[a.condition.op](observed.value, a.condition.value) ? 'supported' : 'contradicted' };
      });
      const status = when.some(w => !w.holds) ? 'inactive'
        : assuming.some(a => a.status === 'contradicted') ? 'contradicted'
        : assuming.some(a => a.status === 'unverified') ? 'unverified'
        : 'applies';
      return { ...c, endorsed: Boolean(endorsed), when, assuming, status, active: status === 'applies' || status === 'unverified' };
    });
  const claimByRid = new Map(claims.map(c => [c.rid, c]));
  const standing = claims.filter(c => c.active && c.endorsed);

  // Disagreements: pairs anywhere in the store, kept when both claims are in scope.
  const disagreements = db.prepare('SELECT claim_a, claim_b FROM claim_disagreement').all()
    .filter(d => claimByRid.has(d.claim_a) && claimByRid.has(d.claim_b))
    .map(d => {
      const a = claimByRid.get(d.claim_a), b = claimByRid.get(d.claim_b);
      return { a: a.ref, b: b.ref, from: a.from, to: a.to,
               conclusions: [`${a.relation} (${a.strength})`, `${b.relation} (${b.strength})`],
               live: a.active && b.active, ...compareContexts(a, b) };
    });

  // The intent tree: each contract's own nesting, plus nested includes hung under the includer's intent.
  const intentRows = db.prepare(`SELECT ci.intent_rid AS rid, ci.combine FROM contract_intent ci
                                 JOIN composition_contract cc ON cc.crid = ci.crid AND cc.root_crid = ?
                                 ORDER BY cc.depth, ci.crid, ci.position`).all(crid);
  const combine = new Map();
  for (const r of intentRows) if (!combine.has(r.rid)) combine.set(r.rid, r.combine);   // the outermost contract decides
  const edges = db.prepare(`SELECT r.child_rid AS child, r.parent_rid AS parent FROM contract_refines r
                            JOIN composition_contract cc ON cc.crid = r.crid AND cc.root_crid = ?`).all(crid);
  const nests = db.prepare(`SELECT i.included_crid, i.under_intent_rid FROM contract_include i
                            JOIN composition_contract cc ON cc.crid = i.crid AND cc.root_crid = ? WHERE i.mode = 'nest'`).all(crid);
  const ownRoots = db.prepare(`SELECT intent_rid FROM contract_intent ci WHERE crid = ? AND NOT EXISTS
                               (SELECT 1 FROM contract_refines r WHERE r.crid = ci.crid AND r.child_rid = ci.intent_rid)
                               ORDER BY position`).pluck();
  for (const n of nests) for (const child of ownRoots.all(n.included_crid)) edges.push({ child, parent: n.under_intent_rid });

  const children = new Map(), hasParent = new Set();
  for (const { child, parent } of edges) {
    if (!children.has(parent)) children.set(parent, []);
    if (!children.get(parent).includes(child)) children.get(parent).push(child);
    hasParent.add(child);
  }

  const node = (rid, path) => {
    const it = nano(rid);
    const supports = standing.filter(c => c.to === it.ref && c.relation === 'supports');
    const hinders = standing.filter(c => c.to === it.ref && c.relation === 'hinders');
    const challenges = claims.filter(c => c.active && !c.endorsed && c.to === it.ref && c.relation === 'hinders');   // filed by others, in scope
    const kids = (children.get(rid) ?? []).filter(k => !path.has(k)).map(k => node(k, new Set([...path, rid])));
    const own = supports.some(c => c.strength === 'sufficient') ? 2 : supports.length ? 1 : 0;
    const ranks = kids.map(k => LEVELS.indexOf(k.coverage));
    const fromChildren = !kids.length ? 0 : (combine.get(rid) === 'any' ? Math.max(...ranks) : Math.min(...ranks));
    return {
      ref: it.ref, statement: it.statement, combine: combine.get(rid),
      coverage: LEVELS[Math.max(own, fromChildren)],
      inTension: hinders.length > 0,
      disputed: disagreements.some(d => d.to === it.ref),
      supports: supports.map(c => c.ref), hinders: hinders.map(c => c.ref), challenges: challenges.map(c => c.ref),
      children: kids,
    };
  };
  const tree = intentRows.map(r => r.rid).filter((rid, i, all) => !hasParent.has(rid) && all.indexOf(rid) === i)
    .map(rid => node(rid, new Set()));

  // Checks.
  const flat = [];
  const walk = n => { if (!flat.some(f => f.ref === n.ref)) flat.push(n); n.children.forEach(walk); };
  tree.forEach(walk);
  const clauses = db.prepare(`SELECT m.rid FROM composition_member m JOIN revision_kind k ON k.rid = m.rid
                              WHERE m.root_crid = ? AND k.kind = 'clause'`).pluck().all(crid).map(nano);
  const targets = (from, relation) => [...new Set(standing.filter(c => c.from === from && c.relation === relation).map(c => c.to))];
  const tensions = clauses.map(cl => ({ clause: cl.ref, supports: targets(cl.ref, 'supports'), hinders: targets(cl.ref, 'hinders') }))
    .filter(t => t.hinders.length);

  const checks = {
    conflicts: claims.filter(c => c.active && c.relation === 'conflicts')
      .map(c => ({ claim: c.ref, between: [c.from, c.to], endorsed: c.endorsed })),
    definitionClashes: db.prepare('SELECT term_id AS term, rid_a, rid_b FROM composition_definition_clash WHERE root_crid = ?').all(crid)
      .map(d => ({ term: d.term, definitions: [nano(d.rid_a).ref, nano(d.rid_b).ref] })),
    gaps: flat.filter(n => n.coverage === 'gap').map(n => n.ref),
    thin: flat.filter(n => n.coverage === 'thin').map(n => n.ref),
    // A clause serves an intent directly (it is a claim's `from`) or as a precondition (it is in a claim's `given`).
    orphans: clauses.filter(cl => !standing.some(c => c.relation !== 'conflicts' && (c.from === cl.ref || c.given.includes(cl.ref))))
      .map(cl => cl.ref),
    tensions,
    disagreements,
  };

  return {
    contract, society, parameters, tree, checks,
    claims: Object.fromEntries(claims.map(c => [c.ref, c])),
    nanos: Object.fromEntries([...cache.values()].map(n => [n.ref, n])),
  };
}
