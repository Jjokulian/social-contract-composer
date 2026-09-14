// Compose a snapshot from the catalogue: which contracts a composition reaches, which nanos are in it, and which claims
// and influences concern it. Pure JavaScript. The server, the static build and the browser's composer all run it, so a
// draft built on the canvas is composed exactly as a stored contract is.
//
//   catalogue: { nanos: { ref: nano }, contracts: { ref: contract }, observations: { measureId: { society: obs } } }
//   spec:      a contract ({ ref, intents, edges, members, parameters, includes, operations, resolution, … }), stored or drafted
import { nanoId } from './evaluate.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function compose(cat, spec) {
  const contractOf = ref => cat.contracts[ref] ?? (() => { throw fail(`no contract ${ref}`, 404); })();
  const nanoOf = ref => cat.nanos[ref] ?? (() => { throw fail(`no nano ${ref}`, 404); })();
  const keyOf = c => c.ref ?? '(draft)';

  // Every contract the composition reaches, with its nesting depth (0 = the composition itself) and the include of the
  // composition it is reached through, which says whether it comes through the base. An abrogated contract is not
  // reached: the operators of each contract act on what it includes, outer contracts first.
  const reached = new Map();
  const abrogated = new Map();   // contract ref → the abrogation
  const queue = [[spec, 0, null]];
  while (queue.length) {
    const [c, depth, via] = queue.shift();
    const key = keyOf(c);
    if (abrogated.has(key) || (reached.has(key) && reached.get(key).depth <= depth)) continue;
    reached.set(key, { c, depth, via });
    for (const o of c.operations ?? []) if (o.op === 'abrogate' && !abrogated.has(o.contract)) abrogated.set(o.contract, { ...o, by: key });
    for (const inc of c.includes ?? []) if (!abrogated.has(inc.ref)) queue.push([contractOf(inc.ref), depth + 1, via ?? inc]);
  }
  const order = [...reached.values()].sort((a, b) => a.depth - b.depth || (a.c.crid ?? 0) - (b.c.crid ?? 0));

  // Members: every intent, member and parameter any reached contract brings in, with the outermost contract that brings
  // it. Then the other operators act on them, outer contracts first. Nothing they act on is dropped from view.
  const members = new Set(), origin = new Map();
  const bring = (ref, key) => { members.add(ref); if (!origin.has(ref)) origin.set(ref, key); };
  for (const { c } of order) {
    const key = keyOf(c);
    c.intents.forEach(i => bring(i.ref, key));
    c.members.forEach(m => bring(m, key));
    Object.keys(c.parameters ?? {}).forEach(p => bring(p, key));
    (c.socioship ?? []).forEach(s => bring(s.nano, key));   // a nano that defines a socioship term is part of the milli
  }
  const operations = [...abrogated.values()];
  for (const { c } of order)
    for (const o of c.operations ?? []) {
      if (o.op === 'abrogate') continue;
      if (o.op === 'derogate') members.delete(o.nano);
      if (o.op === 'obrogate') {   // the replacement takes the place, and the rank, of what it replaces
        members.delete(o.nano);
        members.add(o.replacement);
        origin.set(o.replacement, origin.get(o.nano) ?? keyOf(c));
      }
      if (o.op === 'subrogate') { members.add(o.nano); origin.set(o.nano, reached.has(o.contract) ? o.contract : keyOf(c)); }
      operations.push({ ...o, by: keyOf(c) });
    }
  members.forEach(nanoOf);
  const has = ref => members.has(ref);
  const byRid = refs => [...refs].sort((a, b) => nanoOf(a).rid - nanoOf(b).rid);
  const ofKind = kind => byRid([...members].filter(ref => nanoOf(ref).kind === kind));

  // For the maxims that resolve conflicts: whether a member comes through the composition's base (lex superior), and how
  // late the contract that brings it was composed (lex posterior; a draft is the latest).
  const provenance = Object.fromEntries([...members].map(ref => {
    const { c, via } = reached.get(origin.get(ref)) ?? {};
    return [ref, { from: origin.get(ref), base: Boolean(via?.base), order: c?.crid ?? Number.MAX_SAFE_INTEGER }];
  }));
  const specialis = order.flatMap(({ c }) => c.specialis ?? []);

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
      if (inc.mode !== 'nest' || !reached.has(inc.ref)) continue;
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

  // Socioship, for a milli: the terms on which it is held (structure every milli fills, from the catalogue), each with
  // the nanos that define it. For each term, the outermost contract that defines it decides.
  const socioshipBy = new Map();
  for (const { c } of order) {
    const defined = new Map();
    for (const s of c.socioship ?? []) if (has(s.nano)) defined.set(s.term, [...(defined.get(s.term) ?? []), s.nano]);
    for (const [term, nanos] of defined) if (!socioshipBy.has(term)) socioshipBy.set(term, { nanos, setBy: c.ref ?? '(draft)' });
  }
  const socioship = spec.scale === 'social'
    ? (cat.socioshipTerms ?? []).map(t => ({ ...t, ...(socioshipBy.get(t.id) ?? { nanos: [], setBy: null }) }))
    : null;

  const described = new Set([...members, ...claims.map(c => c.ref), ...claims.flatMap(c => c.measuredBy), ...influences,
                             ...breaches.flatMap(b => b.consequences),
                             ...operations.flatMap(o => [o.nano, o.replacement, o.cites]).filter(Boolean)]);

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
      includes: (spec.includes ?? []).map(i => ({ ref: i.ref, mode: i.mode, base: Boolean(i.base) })),
    },
    parameters, claims, disagreements, observations, intents, edges, clauses, definitionClashes, staleReferences, influences, breaches,
    enforcement, roles, socioship, operations, resolution: spec.resolution ?? [], specialis, provenance,
    nanos: Object.fromEntries(byRid(described).map(ref => [ref, nanoOf(ref)])),
  };
}
