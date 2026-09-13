// Compose a snapshot from the catalogue: which contracts a composition reaches, which nanos are in it, and which claims
// and influences concern it. Pure JavaScript. The server, the static build and the browser's composer all run it, so a
// draft built on the canvas is composed exactly as a stored contract is.
//
//   catalogue: { nanos: { ref: nano }, contracts: { ref: contract }, observations: { measureId: { society: obs } } }
//   spec:      a contract ({ ref, intents, edges, members, parameters, includes, … }), stored or drafted
import { nanoId } from './evaluate.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function compose(cat, spec) {
  const contractOf = ref => cat.contracts[ref] ?? (() => { throw fail(`no contract ${ref}`, 404); })();
  const nanoOf = ref => cat.nanos[ref] ?? (() => { throw fail(`no nano ${ref}`, 404); })();

  // Every contract the composition reaches, with its nesting depth (0 = the composition itself).
  const reached = new Map();
  const queue = [[spec, 0]];
  while (queue.length) {
    const [c, depth] = queue.shift();
    const key = c.ref ?? '(draft)';
    if (reached.has(key) && reached.get(key).depth <= depth) continue;
    reached.set(key, { c, depth });
    for (const inc of c.includes ?? []) queue.push([contractOf(inc.ref), depth + 1]);
  }
  const order = [...reached.values()].sort((a, b) => a.depth - b.depth || (a.c.crid ?? 0) - (b.c.crid ?? 0));

  // Members: every intent, member and parameter any reached contract brings in.
  const members = new Set();
  for (const { c } of order) {
    c.intents.forEach(i => members.add(i.ref));
    c.members.forEach(m => members.add(m));
    Object.keys(c.parameters ?? {}).forEach(p => members.add(p));
  }
  members.forEach(nanoOf);
  const has = ref => members.has(ref);
  const byRid = refs => [...refs].sort((a, b) => nanoOf(a).rid - nanoOf(b).rid);
  const ofKind = kind => byRid([...members].filter(ref => nanoOf(ref).kind === kind));

  // Parameter values: the outermost contract that sets one wins.
  const values = new Map();
  for (const { c } of [...order].sort((a, b) => a.depth - b.depth || (b.c.crid ?? Infinity) - (a.c.crid ?? Infinity)))
    for (const [ref, value] of Object.entries(c.parameters ?? {})) if (!values.has(ref)) values.set(ref, value);
  const parameters = [...values].map(([ref, value]) => ({ ...nanoOf(ref), value }));

  // Claims anywhere in the catalogue whose ends and preconditions are all in the composition.
  const everything = Object.values(cat.nanos).sort((a, b) => a.rid - b.rid);
  const claims = everything.filter(n => n.kind === 'claim' && has(n.from) && has(n.to) && n.given.every(has))
    .map(n => ({ ...n, endorsed: has(n.ref) }));
  const disagreements = [];
  for (let i = 0; i < claims.length; i++)
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i], b = claims[j];
      if (nanoId(a.from) === nanoId(b.from) && nanoId(a.to) === nanoId(b.to) && (a.relation !== b.relation || a.strength !== b.strength))
        disagreements.push([a.ref, b.ref]);
    }
  const influences = everything.filter(n => n.kind === 'influence' && has(n.from) && has(n.to)).map(n => n.ref);

  // Every society's latest observation of the measures the claims mention.
  const measures = new Set(claims.flatMap(c => [...c.measuredBy, ...c.assuming.filter(a => a.condition).map(a => a.condition.measure)].map(nanoId)));
  const observations = Object.fromEntries([...measures].filter(m => cat.observations[m]).map(m => [m, cat.observations[m]]));

  // The intent tree: each contract's own nesting, plus nested includes hung under the includer's intent.
  const intents = [];
  for (const { c } of order) for (const i of c.intents) if (!intents.some(x => x.ref === i.ref)) intents.push({ ref: i.ref, combine: i.combine });
  // Edges in contract order, oldest first and a draft last, so a base contract's own structure comes before additions.
  const byAge = [...order].sort((a, b) => (a.c.crid ?? Infinity) - (b.c.crid ?? Infinity));
  const edges = byAge.flatMap(({ c }) => c.edges);
  for (const { c } of byAge) {
    for (const inc of c.includes ?? []) {
      if (inc.mode !== 'nest') continue;
      const inner = contractOf(inc.ref);
      for (const root of inner.intents.filter(i => !inner.edges.some(e => e.child === i.ref))) edges.push({ child: root.ref, parent: inc.under });
    }
  }

  const clauses = ofKind('clause');

  // Consequences of breach are set by the composition: for each clause, the outermost contract that attaches any decides.
  const breachByClause = new Map();
  for (const { c } of order) {
    const attached = new Map();
    for (const b of c.breaches ?? []) if (has(b.clause)) attached.set(b.clause, [...(attached.get(b.clause) ?? []), b.consequence]);
    for (const [clause, consequences] of attached)
      if (!breachByClause.has(clause)) breachByClause.set(clause, { clause, consequences, setBy: c.ref ?? '(draft)' });
  }
  const breaches = byRid(breachByClause.keys()).map(clause => breachByClause.get(clause));

  // Who detects breaches and applies consequences: set by the composing signatories; the outermost contract decides.
  const enforcedBy = new Map();
  for (const { c } of order) {
    const assigned = new Map();
    for (const e of c.enforcement ?? []) if (has(e.clause)) assigned.set(e.clause, [...(assigned.get(e.clause) ?? []), e.by]);
    for (const [clause, by] of assigned) if (!enforcedBy.has(clause)) enforcedBy.set(clause, { clause, by, setBy: c.ref ?? '(draft)' });
  }
  const enforcement = byRid(enforcedBy.keys()).map(clause => enforcedBy.get(clause));
  const roles = Object.fromEntries((cat.roles ?? []).map(r => [r.id, r.label]));

  const described = new Set([...members, ...claims.map(c => c.ref), ...claims.flatMap(c => c.measuredBy), ...influences,
                             ...breaches.flatMap(b => b.consequences)]);
  if (spec.territory && cat.nanos[spec.territory]) described.add(spec.territory);   // a draft may name a territory in words only

  // The picos every described nano refers to (recorded with the nano), and the picos those picos refer to.
  for (const queue = [...described]; queue.length;)
    for (const { pico } of nanoOf(queue.pop()).picos ?? [])
      if (!described.has(pico)) { described.add(pico); queue.push(pico); }

  // Two definitions of one term in play. Different picos are competing senses; two revisions of one pico mean some nanos
  // were written with another revision than the composition defines. Neither ever changes a nano: they are shown, for
  // the authors to settle.
  const definitions = byRid([...described].filter(ref => nanoOf(ref).kind === 'definition'));
  const definitionClashes = [];
  for (let i = 0; i < definitions.length; i++)
    for (let j = i + 1; j < definitions.length; j++)
      if (nanoOf(definitions[i]).term === nanoOf(definitions[j]).term)
        definitionClashes.push({ term: nanoOf(definitions[i]).term, definitions: [definitions[i], definitions[j]],
                                 kind: nanoId(definitions[i]) === nanoId(definitions[j]) ? 'versions' : 'senses' });
  const current = new Map(ofKind('definition').map(ref => [nanoId(ref), ref]));
  const staleReferences = [];
  for (const ref of byRid(described))
    for (const { phrase, pico } of nanoOf(ref).picos ?? [])
      if (current.has(nanoId(pico)) && current.get(nanoId(pico)) !== pico)
        staleReferences.push({ nano: ref, phrase, pico, current: current.get(nanoId(pico)) });
  return {
    contract: {
      id: spec.id, rev: spec.rev, ref: spec.ref, scale: spec.scale, title: spec.title, status: spec.status, source: spec.source,
      territory: spec.territory ?? null,
      includes: (spec.includes ?? []).map(i => ({ ref: i.ref, mode: i.mode })),
    },
    parameters, claims, disagreements, observations, intents, edges, clauses, definitionClashes, staleReferences, influences, breaches,
    enforcement, roles,
    nanos: Object.fromEntries(byRid(described).map(ref => [ref, nanoOf(ref)])),
  };
}
