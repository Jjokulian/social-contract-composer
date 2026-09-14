// Relink a contract: bring its nanos' recorded pico references up to the picos it defines, by writing new revisions —
// never by changing old ones. Text never changes; only the recorded references do.
//
// The cascade, in dependency order: picos whose definitions gain references; the nanos that use a rewritten pico or gain
// references; the claims and influences that point at anything rewritten; then a contract revision pinning it all.
// Existing references are kept. A nano that someone else's claim in the contract points at is left alone and reported as
// blocked: rewriting it would silently detach their claim.
import { addNano, reviseContract, resolveContract, catalogue, TEXT_FIELD } from './store.mjs';
import { compose } from '../public/compose.mjs';
import { suggest } from '../public/picos.mjs';
import { latestById } from '../public/common.mjs';

// What addNano takes, from what describe() returns.
function toInput(n) {
  const base = { id: n.id, kind: n.kind };
  switch (n.kind) {
    case 'intent': return { ...base, statement: n.statement };
    case 'clause': return { ...base, role: n.role, modality: n.modality, text: n.text, ...(n.bindingStated ? { binding: n.binding } : {}) };
    case 'definition': return { ...base, term: n.term, meaning: n.meaning, forms: n.forms };
    case 'parameter': return { ...base, label: n.label, unit: n.unit, min: n.min, max: n.max, meaning: n.meaning };
    case 'measure': return { ...base, label: n.label, unit: n.unit, description: n.description };
    case 'assumption': return { ...base, statement: n.statement, ...(n.condition ? { condition: { ...n.condition } } : {}) };
    case 'consequence': return { ...base, statement: n.statement };
    case 'unit': return { ...base, form: n.form, name: n.name, language: n.language, text: n.text, depends: n.depends.map(d => ({ ...d })) };
    case 'claim': return { ...base, from: n.from, relation: n.relation, to: n.to, strength: n.strength, rationale: n.rationale,
      given: [...n.given], when: n.when.map(w => ({ parameter: w.parameter, op: w.op, value: w.value })),
      assuming: n.assuming.map(a => a.ref), measuredBy: [...n.measuredBy] };
    case 'influence': return { ...base, from: n.from, direction: n.direction, to: n.to, rationale: n.rationale };
    default: throw new Error(`cannot relink a ${n.kind}`);
  }
}

// References a nano holds to other nanos (as opposed to picos).
const pointers = n => n.kind === 'claim'
  ? [n.from, n.to, ...n.given, ...n.assuming.map(a => a.ref ?? a), ...n.measuredBy, ...n.when.map(w => w.parameter)]
  : n.kind === 'influence' ? [n.from, n.to]
  : n.kind === 'assumption' && n.condition ? [n.condition.measure] : [];

function remap(input, map) {
  const m = ref => map.get(ref) ?? ref;
  if (input.kind === 'claim') return { ...input, from: m(input.from), to: m(input.to), given: input.given.map(m),
    assuming: input.assuming.map(m), measuredBy: input.measuredBy.map(m), when: input.when.map(w => ({ ...w, parameter: m(w.parameter) })) };
  if (input.kind === 'influence') return { ...input, from: m(input.from), to: m(input.to) };
  if (input.kind === 'assumption' && input.condition) return { ...input, condition: { ...input.condition, measure: m(input.condition.measure) } };
  return input;
}

export function relinkContract(db, contractRef, { filedBy, source }) {
  const crid = resolveContract(db, contractRef);
  const ref = db.prepare("SELECT contract_id || '@' || rev FROM contract_rev WHERE crid = ?").pluck().get(crid);
  const cat = catalogue(db);
  const spec = cat.contracts[ref];
  const snap = compose(cat, spec);
  const nano = r => snap.nanos[r] ?? cat.nanos[r];

  // What this contract itself holds, plus the influences in its scope: the nanos a relink may rewrite.
  const own = new Set([...spec.intents.map(i => i.ref), ...spec.members, ...Object.keys(spec.parameters ?? {})]);
  const candidates = new Set([...own, ...snap.influences.filter(i => own.has(nano(i).from) || own.has(nano(i).to))]);
  // Someone else's claims in scope pin what they point at.
  const blockedBy = new Map();
  for (const c of snap.claims) if (!candidates.has(c.ref))
    for (const target of pointers(c)) blockedBy.set(target, [...(blockedBy.get(target) ?? []), c.ref]);

  const map = new Map();              // old ref → new ref
  // pico id → pico (latest revision the contract defines, updated as picos are rewritten)
  const defined = latestById([...own].map(nano).filter(n => n.kind === 'definition'));
  const picoList = () => [...defined.values()].map(p => ({ ref: p.ref, forms: p.forms }));
  const blocked = [], rewritten = [];

  // A nano's references after relinking: its recorded ones (following rewritten picos), plus any suggestions missing.
  const referencesFor = n => {
    const kept = (n.picos ?? []).map(p => ({ phrase: p.phrase, pico: map.get(p.pico) ?? p.pico }));
    const missing = suggest(n[TEXT_FIELD[n.kind]] ?? '', picoList(), n.ref)
      .filter(s => !kept.some(k => k.phrase.toLowerCase() === s.phrase.toLowerCase()));
    return [...kept, ...missing];
  };
  const differs = (n, refs) => JSON.stringify(refs) !== JSON.stringify(n.picos ?? []);
  const rewrite = n => {
    const refs = referencesFor(n);
    const input = remap(toInput(n), map);
    const pointsAtRewritten = pointers(n).some(p => map.has(p));
    if (!differs(n, refs) && !pointsAtRewritten) return false;
    if (blockedBy.has(n.ref)) { blocked.push({ nano: n.ref, by: blockedBy.get(n.ref) }); return false; }
    const next = addNano(db, { ...input, filedBy: n.filedBy, source, picos: refs, implementedBy: n.implementedBy ?? [] }).ref;
    map.set(n.ref, next);
    rewritten.push([n.ref, next]);
    if (n.kind === 'definition') defined.set(n.id, { ...n, ref: next, rev: n.rev + 1, picos: refs });
    return true;
  };

  return db.transaction(() => {
    // Picos first, each once, in dependency order: a pico whose definition refers to another pico comes after it, so it
    // records the other's new revision. A cycle (two definitions naming each other) is walked once, never looped.
    const picos = [...candidates].map(nano).filter(n => n.kind === 'definition');
    const refsOf = new Map(picos.map(p => [p.ref, referencesFor(p).map(r => r.pico).filter(r => r !== p.ref && picos.some(q => q.ref === r))]));
    const sorted = [], seen = new Set();
    const visit = (r, path = new Set()) => {
      if (seen.has(r) || path.has(r)) return;
      path.add(r);
      for (const dep of refsOf.get(r) ?? []) visit(dep, path);
      seen.add(r);
      sorted.push(r);
    };
    picos.forEach(p => visit(p.ref));
    for (const r of sorted) rewrite(defined.get(nano(r).id));
    // Then everything else that holds text; then what points at rewritten nanos.
    const rest = [...candidates].map(nano).filter(n => n.kind !== 'definition');
    const order = n => (n.kind === 'claim' || n.kind === 'influence' ? 2 : n.kind === 'assumption' ? 1 : 0);
    for (const n of rest.sort((a, b) => order(a) - order(b))) rewrite(n);

    const replace = Object.fromEntries([...map].filter(([old]) => own.has(old)));
    const revised = Object.keys(replace).length
      ? reviseContract(db, ref, { replace, filedBy, source }).ref
      : null;
    return { contract: revised, rewritten, blocked };
  })();
}
