// The Levels view's graph: every milli, micro, nano and pico of a store, with the relations between them: composing
// (includes, the base, the operators), holding, refining, using picos, claims, influences, breaches and precedence.
// Pure JavaScript over a catalogue (server/store.mjs → catalogue), so the page and the tests compute it the same way.
import { compose } from './compose.mjs';
import { evaluate } from './evaluate.mjs';
import { short, latestById } from './common.mjs';

export const LEVELS = { milli: 'Millis', micro: 'Micros', nano: 'Nanos', pico: 'Picos' };
export const RELATIONS = {
  composes: ['Includes', 'A contract includes another: nests or adds it, and may mark it as its base'],
  operates: ['Operators', 'A contract abrogates, derogates, subrogates or obrogates what it includes'],
  holds: ['Holds', 'A contract holds its own intents, provisions and parameters'],
  refines: ['Refines', 'An intent refines another, within a contract'],
  uses: ['Uses picos', 'A nano or a pico uses a pico, by the reference recorded with it'],
  claims: ['Claims', 'A clause supports or hinders an intent, or two provisions conflict'],
  influences: ['Influences', 'What bears on what'],
  breaches: ['Breaches', 'The consequence a composition attaches to a clause'],
  precedence: ['Precedence', 'A provision prevails over another, by a maxim its milli states'],
  depends: ['Depends', 'A unit of software imports or uses another'],
  implements: ['Implements', 'A unit of software implements a pico or a functional unit'],
  evaluates: ['Evaluations', 'An observed value of a measure, in a named society'],
};
const HIERARCHY = new Set(['composes', 'holds', 'uses']);   // these run downward: milli → micro → nano → pico
const AS_CONNECTIONS = new Set(['claim', 'influence', 'evaluation']);   // nanos drawn as connections, not as nodes

// A unit of software that declares something and depends on no other unit is a logical unit, a pico; one that uses
// others is a functional unit, a nano.
const LOGICAL_FORMS = new Set(['function', 'const', 'let', 'var', 'class', 'rule', 'table', 'view']);
const logical = u => LOGICAL_FORMS.has(u.form) && !(u.depends ?? []).length;
export const levelOf = x => (x.scale ? (x.scale === 'social' ? 'milli' : 'micro')
  : x.kind === 'definition' || (x.kind === 'unit' && logical(x)) ? 'pico' : 'nano');
const textOf = x => (x.kind === 'unit' ? `${x.form} ${x.name ?? ''}`.trim()
  : x.kind === 'evaluation' ? `${x.society}: ${x.value} (${x.observedOn})`
  : x.title ?? x.statement ?? x.text ?? x.label ?? x.termLabel ?? x.meaning ?? x.ref);

//   scope:     'all', or a contract id: that contract and what it reaches
//   levels:    the levels to show; a hidden level is crossed, not cut
//   relations: the relations to show
//   revisions: 'merge' draws each nano and contract once, at its latest revision; 'apart' draws every pinned revision
// The whole graph for a scope, before any filter: every node at every level, and every relation. Filtering it
// (filterGraph) is cheap, so a page builds it once per scope and only filters it when the levels or relations change.
export function buildGraph(cat, { scope = 'all', revisions = 'merge' } = {}) {
  const latestContract = latestById(Object.values(cat.contracts));
  const latestNano = latestById(Object.values(cat.nanos));
  const merge = revisions === 'merge';
  const key = ref => {
    if (!merge) return ref;
    const id = String(ref).split('@')[0];
    return (cat.contracts[ref] ? latestContract.get(id) : latestNano.get(id))?.ref ?? ref;
  };

  // The contracts in scope, following what each includes: its pinned revision, or with revisions merged, its latest.
  const start = scope === 'all' ? [...latestContract.values()].filter(c => c.status !== 'retired') : [latestContract.get(scope)].filter(Boolean);
  const contracts = new Map();
  for (const queue = [...start]; queue.length;) {
    const c = queue.shift();
    if (contracts.has(c.ref)) continue;
    contracts.set(c.ref, c);
    for (const inc of c.includes ?? []) { const next = cat.contracts[key(inc.ref)]; if (next) queue.push(next); }
  }

  const nodes = new Map(), edges = [];
  const addNode = x => {
    const id = key(x.ref);
    if (!nodes.has(id)) {
      const shown = cat.contracts[id] ?? cat.nanos[id] ?? x;
      nodes.set(id, { id, level: levelOf(shown), kind: shown.kind ?? shown.scale, label: short(textOf(shown), 64), title: textOf(shown),
                      ...(shown.status && { status: shown.status }), ...(shown.scale && { contract: shown.id }),
                      ...(shown.form && { form: shown.form }) });
    }
    return id;
  };
  const addNano = ref => { const n = cat.nanos[ref]; if (!n || AS_CONNECTIONS.has(n.kind)) return null; return addNode(n); };
  const link = (kind, source, target, data = {}) => { if (source && target && source !== target) edges.push({ kind, source: key(source), target: key(target), ...data }); };

  for (const c of contracts.values()) {
    addNode(c);
    for (const inc of c.includes ?? [])
      if (cat.contracts[key(inc.ref)]) link('composes', c.ref, inc.ref, { mode: inc.mode, base: Boolean(inc.base), label: `${inc.mode === 'nest' ? 'nests' : 'adds'}${inc.base ? ' · base' : ''}` });
    const held = [...c.intents.map(i => i.ref), ...c.members, ...Object.keys(c.parameters ?? {}), ...(c.socioship ?? []).map(s => s.nano)];
    for (const ref of new Set(held)) if (addNano(ref)) link('holds', c.ref, ref);
    for (const e of c.edges ?? []) link('refines', e.child, e.parent);
    for (const o of c.operations ?? []) {
      if (o.op === 'abrogate') { if (cat.contracts[key(o.contract)]) { addNode(cat.contracts[key(o.contract)]); link('operates', c.ref, o.contract, { op: o.op, label: 'abrogates' }); } continue; }
      if (!addNano(o.nano)) continue;
      link('operates', c.ref, o.nano, { op: o.op, label: o.op === 'subrogate' ? `subrogates into ${o.contract}` : `${o.op}s` });
      if (o.op === 'obrogate' && addNano(o.replacement)) link('operates', c.ref, o.replacement, { op: o.op, label: 'obrogates with' });
    }
    for (const b of c.breaches ?? []) if (addNano(b.consequence)) link('breaches', b.clause, b.consequence, { label: 'if breached' });
    if ((c.resolution ?? []).length) {
      try {
        for (const x of evaluate(compose(cat, c), {}).checks.conflicts)
          if (x.resolution) link('precedence', x.resolution.prevails, x.resolution.setAside, { maxim: x.resolution.by, label: `lex ${x.resolution.by}` });
      } catch { /* a contract that doesn't compose has no precedence to show */ }
    }
  }
  // The picos every nano and pico uses, and the picos those use in turn.
  for (const queue = [...nodes.keys()]; queue.length;) {
    const ref = queue.shift();
    for (const { pico } of cat.nanos[ref]?.picos ?? []) {
      const had = nodes.has(key(pico));
      if (addNano(pico) && !had) queue.push(key(pico));
      link('uses', ref, pico);
    }
  }
  // Which units of software implement each pico and functional unit, recorded with it by the unit's id.
  for (const id of [...nodes.keys()])
    for (const unitId of cat.nanos[id]?.implementedBy ?? []) {
      const target = latestNano.get(unitId);
      if (target && addNano(target.ref)) link('implements', target.ref, id);
    }
  // What each unit of software imports and uses, by the other unit's id (the platform follows each unit's latest revision).
  for (const id of [...nodes.keys()]) {
    const n = cat.nanos[id];
    if (n?.kind !== 'unit') continue;
    for (const d of n.depends ?? []) {
      const target = latestNano.get(d.id);
      if (target && addNano(target.ref)) link('depends', id, target.ref, { relation: d.relation, label: d.relation === 'imports' ? 'imports' : '' });
    }
  }
  for (const n of Object.values(cat.nanos)) {
    const ends = n.from && n.to && nodes.has(key(n.from)) && nodes.has(key(n.to));
    if (n.kind === 'claim' && ends) link('claims', n.from, n.to, { relation: n.relation, strength: n.strength });
    if (n.kind === 'influence' && ends) link('influences', n.from, n.to, { direction: n.direction });
    if (n.kind === 'evaluation' && nodes.has(key(n.measure))) link('evaluates', addNode(n), n.measure, { label: n.society });
  }

  return { nodes, edges };
}

// The graph as shown: the chosen levels and relations, with every hidden level crossed, not cut.
export function filterGraph({ nodes, edges }, { levels = Object.keys(LEVELS), relations = Object.keys(RELATIONS) } = {}) {
  const shownLevels = new Set(levels), on = new Set(relations);
  const visible = id => nodes.has(id) && shownLevels.has(nodes.get(id).level);
  const unique = new Map();
  for (const e of edges)
    if (on.has(e.kind) && visible(e.source) && visible(e.target)) unique.set(`${e.kind}|${e.source}|${e.target}|${e.label ?? e.relation ?? ''}`, e);

  // A hidden level is crossed, not cut: each shown node is connected to the shown nodes below it that it reaches only
  // through hidden ones, so millis and picos alone still show which picos each milli rests on.
  if ([...HIERARCHY].some(k => on.has(k))) {
    const down = new Map();
    for (const e of edges) if (HIERARCHY.has(e.kind)) down.set(e.source, [...new Set([...(down.get(e.source) ?? []), e.target])]);
    for (const id of nodes.keys()) {
      if (!visible(id)) continue;
      const direct = new Set(down.get(id) ?? []), seen = new Set();
      for (const stack = [...direct].filter(c => !visible(c)); stack.length;) {
        const c = stack.pop();
        if (seen.has(c)) continue;
        seen.add(c);
        for (const next of down.get(c) ?? []) {
          if (!visible(next)) stack.push(next);
          else if (next !== id && !direct.has(next)) unique.set(`through|${id}|${next}`, { kind: 'through', source: id, target: next });
        }
      }
    }
  }
  return { nodes: [...nodes.values()].filter(n => shownLevels.has(n.level)), edges: [...unique.values()] };
}

export const levelGraph = (cat, options = {}) => filterGraph(buildGraph(cat, options), options);
