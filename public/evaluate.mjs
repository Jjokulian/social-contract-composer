// Evaluate a composition snapshot. Pure JavaScript, no database: the server and the browser run this same module.
// A snapshot (server/checks.mjs → snapshot) holds everything in scope for one contract. Evaluating it at chosen
// parameter values, for a chosen society, yields the composition report. Every step is one pass or a pairwise
// comparison; nothing searches.

export const nanoId = ref => String(ref).split('@')[0];

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

const whenKey = w => `${w.parameter} ${w.op} ${w.value}`;
const within = (a, b) => a.every(x => b.includes(x));

// A stronger claim with more context refines a weaker one: "alone it contributes; with these, it suffices".
// That is consistent, not a disagreement, so it is reported apart.
const refines = (weak, strong) => weak.relation === strong.relation
  && weak.strength === 'contributes' && strong.strength === 'sufficient'
  && within(weak.given, strong.given)
  && within(weak.when.map(whenKey), strong.when.map(whenKey))
  && within(weak.assuming.map(a => a.ref), strong.assuming.map(a => a.ref));

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

  const cruxes = pick => {
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
const invalid = message => Object.assign(new Error(message), { status: 400 });

export function evaluate(snap, { parameters: overrides = {}, society = null } = {}) {
  const { nanos } = snap;

  // Parameters: the composition's values, optionally overridden to explore alternatives.
  const parameters = snap.parameters.map(p => {
    const override = overrides[p.id] ?? overrides[p.ref];
    if (override === undefined || override === null || override === '') return { ...p, contractValue: p.value, overridden: false };
    const v = Number(override);
    if (!(v >= p.min && v <= p.max)) throw invalid(`${p.label} must be between ${p.min} and ${p.max} ${p.unitLabel}`);
    return { ...p, value: v, contractValue: p.value, overridden: v !== p.value };
  });
  const parameterValue = new Map(parameters.map(p => [p.id, p.value]));

  // Claims in scope, with their conditions evaluated.
  const claims = snap.claims.map(c => {
    const when = c.when.map(w => {
      const current = parameterValue.get(nanoId(w.parameter));
      return { ...w, current: current ?? null, holds: current !== undefined && HOLDS[w.op](current, w.value) };
    });
    const assuming = c.assuming.map(a => {
      const observed = a.condition && society ? snap.observations[nanoId(a.condition.measure)]?.[society] : undefined;
      if (!observed) return { ...a, status: 'unverified' };
      return { ...a, observed, status: HOLDS[a.condition.op](observed.value, a.condition.value) ? 'supported' : 'contradicted' };
    });
    const status = when.some(w => !w.holds) ? 'inactive'
      : assuming.some(a => a.status === 'contradicted') ? 'contradicted'
      : assuming.some(a => a.status === 'unverified') ? 'unverified'
      : 'applies';
    return { ...c, when, assuming, status, active: status === 'applies' || status === 'unverified' };
  });
  const claimByRef = new Map(claims.map(c => [c.ref, c]));
  const standing = claims.filter(c => c.active && c.endorsed);

  const pairs = snap.disagreements.map(([refA, refB]) => [claimByRef.get(refA), claimByRef.get(refB)]);
  const isRefinement = ([a, b]) => refines(a, b) || refines(b, a);
  const refinements = pairs.filter(isRefinement).map(([a, b]) => {
    const [weak, strong] = refines(a, b) ? [a, b] : [b, a];
    return { weak: weak.ref, strong: strong.ref, from: a.from, to: a.to,
             adds: [...strong.given.filter(x => !weak.given.includes(x)), ...strong.when.map(whenKey).filter(x => !weak.when.map(whenKey).includes(x)),
                    ...strong.assuming.map(x => x.ref).filter(x => !weak.assuming.some(y => y.ref === x))] };
  });
  const disagreements = pairs.filter(p => !isRefinement(p)).map(([a, b]) => ({
    a: a.ref, b: b.ref, from: a.from, to: a.to,
    conclusions: [`${a.relation} (${a.strength})`, `${b.relation} (${b.strength})`],
    live: a.active && b.active, ...compareContexts(a, b),
  }));

  // The intent tree, rolled up through all-of / any-of.
  const combine = new Map(snap.intents.map(i => [i.ref, i.combine]));
  const children = new Map(), hasParent = new Set();
  for (const { child, parent } of snap.edges) {
    if (!children.has(parent)) children.set(parent, []);
    if (!children.get(parent).includes(child)) children.get(parent).push(child);
    hasParent.add(child);
  }
  const node = (ref, path) => {
    const supports = standing.filter(c => c.to === ref && c.relation === 'supports');
    const hinders = standing.filter(c => c.to === ref && c.relation === 'hinders');
    const challenges = claims.filter(c => c.active && !c.endorsed && c.to === ref && c.relation === 'hinders');   // filed by others, in scope
    const kids = (children.get(ref) ?? []).filter(k => !path.has(k)).map(k => node(k, new Set([...path, ref])));
    const own = supports.some(c => c.strength === 'sufficient') ? 2 : supports.length ? 1 : 0;
    const ranks = kids.map(k => LEVELS.indexOf(k.coverage));
    const fromChildren = !kids.length ? 0 : (combine.get(ref) === 'any' ? Math.max(...ranks) : Math.min(...ranks));
    return {
      ref, statement: nanos[ref].statement, combine: combine.get(ref),
      coverage: LEVELS[Math.max(own, fromChildren)],
      inTension: hinders.length > 0,
      disputed: disagreements.some(d => d.to === ref),
      supports: supports.map(c => c.ref), hinders: hinders.map(c => c.ref), challenges: challenges.map(c => c.ref),
      influences: snap.influences.filter(i => nanos[i].to === ref),   // what bears on this intent; shown, never counted
      children: kids,
    };
  };
  const tree = snap.intents.map(i => i.ref).filter(ref => !hasParent.has(ref)).map(ref => node(ref, new Set()));

  // Checks.
  const flat = [];
  const walk = n => { if (!flat.some(f => f.ref === n.ref)) flat.push(n); n.children.forEach(walk); };
  tree.forEach(walk);
  const targets = (from, relation) => [...new Set(standing.filter(c => c.from === from && c.relation === relation).map(c => c.to))];

  const checks = {
    conflicts: claims.filter(c => c.active && c.relation === 'conflicts')
      .map(c => ({ claim: c.ref, between: [c.from, c.to], endorsed: c.endorsed })),
    definitionClashes: snap.definitionClashes,
    gaps: flat.filter(n => n.coverage === 'gap').map(n => n.ref),
    thin: flat.filter(n => n.coverage === 'thin').map(n => n.ref),
    // A clause serves an intent directly (it is a claim's `from`) or as a precondition (it is in a claim's `given`).
    orphans: snap.clauses.filter(cl => !standing.some(c => c.relation !== 'conflicts' && (c.from === cl || c.given.includes(cl)))),
    tensions: snap.clauses.map(cl => ({ clause: cl, supports: targets(cl, 'supports'), hinders: targets(cl, 'hinders') }))
      .filter(t => t.hinders.length),
    disagreements,
    refinements,
    // A consequence is only real if someone detects the breach: clauses with consequences but no one assigned to that work.
    unenforced: snap.breaches.filter(b => !snap.enforcement.some(e => e.clause === b.clause)).map(b => b.clause),
  };

  return {
    contract: snap.contract, society, parameters, tree, checks,
    influences: snap.influences,
    breaches: snap.breaches,
    enforcement: snap.enforcement,
    roles: snap.roles,
    clauses: snap.clauses,
    claims: Object.fromEntries(claims.map(c => [c.ref, c])),
    nanos,
  };
}
