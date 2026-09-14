// Digesting the platform. The extractor stores the software syntactically, unit by unit (server/platform.mjs); a digest
// adds what it is made of in meaning: its logical units (picos), its functional units (nanos: clauses the platform
// carries out) and the purposes each service serves (intents), each linked to the units of code that implement it, and
// claims that the functional units serve the purposes, so a service reads like any contract, with coverage and gaps.
//
// Agents read a service's units and look up what the stores already hold, so that a concept is defined once and named
// consistently; their proposals are reconciled into one digest, applied here as new revisions filed by claude-draft.
import Database from 'better-sqlite3';
import { addVocabulary, addNano, reviseContract, catalogue } from './store.mjs';
import { relinkContract } from './relink.mjs';
import { heldPicos, currentUnits } from './platform.mjs';
import { suggest } from '../public/picos.mjs';

const latestOf = list => { const by = new Map(); for (const x of list) if (!by.has(x.id) || by.get(x.id).rev < x.rev) by.set(x.id, x); return by; };

// ─── Looking up what exists ──────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'by', 'with', 'is', 'it', 'its', 'as', 'at', 'be',
                      'that', 'this', 'from', 'into', 'shall', 'may', 'not', 'each', 'every', 'which', 'what', 'when']);
// Words, with identifiers split (renderGlossary → render glossary) and plurals folded, so code and prose meet.
export const tokens = s => new Set(String(s ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)
  .filter(w => w.length > 1 && !STOP.has(w)).map(w => w.replace(/ies$/, 'y').replace(/(?<=\w{3})s$/, '')));

// The picos, functional units and intents in the given stores that resemble the words, best first: shared words over
// all words (a long meaning counts as twelve), plus one where the words are exactly one of a pico's forms.
export function lookup(sources, words, { kind = null, limit = 12 } = {}) {
  const q = tokens(words), exact = String(words).trim().toLowerCase();
  const found = [];
  for (const { store, cat } of sources)
    for (const n of latestOf(Object.values(cat.nanos)).values()) {
      if (!['definition', 'clause', 'intent'].includes(n.kind) || (kind && n.kind !== kind)) continue;
      const t = tokens([n.term, n.termLabel, ...(n.forms ?? []), n.meaning, n.text, n.statement].filter(Boolean).join(' '));
      const shared = [...q].filter(w => t.has(w)).length;
      const form = (n.forms ?? []).some(f => f.toLowerCase() === exact);
      if (!shared && !form) continue;
      found.push({ store, ref: n.ref, kind: n.kind, score: shared / (q.size + Math.min(t.size, 12) - shared || 1) + (form ? 1 : 0),
                   words: n.kind === 'definition' ? `${n.termLabel} (${n.forms.join(', ')}): ${n.meaning}` : n.text ?? n.statement,
                   ...(n.implementedBy && { implementedBy: n.implementedBy }) });
    }
  return found.sort((a, b) => b.score - a.score).slice(0, limit);
}

// A service's files and their units: what an agent reads before digesting it.
export function serviceUnits(cat, service) {
  const contracts = latestOf(Object.values(cat.contracts));
  const s = contracts.get(`service.${service}`);
  if (!s) throw new Error(`no service ${service}: the services are ${[...contracts.keys()].filter(k => k.startsWith('service.')).map(k => k.slice(8)).join(', ')}`);
  return {
    service, title: s.title, ref: s.ref,
    files: s.includes.map(i => cat.contracts[i.ref]).map(f => ({
      path: f.title, ref: f.ref,
      units: f.members.map(ref => cat.nanos[ref]).map(u => ({ id: u.id, form: u.form, name: u.name, lines: u.text.split('\n').length - 1,
                                                             depends: u.depends.map(d => d.id), text: u.text })),
    })),
  };
}

// ─── Applying a reconciled digest ────────────────────────────────────────────
//
//   { roles:    [[id, label]],
//     picos:    [{ id, term, label, meaning, forms, implementedBy: [unit id] }],     an existing id: gains implementing units
//     services: [{ service, intents: [{ id, statement, parent? }],
//                  nanos:   [{ id, role?, modality?, text, implementedBy, serves: [{ intent, strength, rationale }] }],
//                  picos:   [pico id] }] }                                          the picos the service holds
export function apply(db, digest, { source = 'digested by agents from the platform’s code, 2026-09-14' } = {}) {
  const by = { filedBy: 'claude-draft', source };
  const revised = db.transaction(() => {
    for (const [id, label] of digest.roles ?? []) addVocabulary(db, 'role', id, label);
    const cat = catalogue(db);
    const nanos = latestOf(Object.values(cat.nanos)), contracts = latestOf(Object.values(cat.contracts));
    const live = currentUnits(contracts);   // only code that a current file holds can implement anything
    const unit = id => { if (!live.has(id)) throw new Error(`no unit of software ${id} in any current file`); return id; };

    // No new pico may take a form another pico already has: a form links wherever it occurs, so it must mean one thing.
    const formOwner = new Map(heldPicos(contracts, nanos).flatMap(p => p.forms.map(f => [f.toLowerCase(), p.id])));
    for (const p of digest.picos ?? []) {
      if (nanos.has(p.id)) continue;
      for (const f of p.forms ?? []) {
        const owner = formOwner.get(f.toLowerCase());
        if (owner && owner !== p.id) throw new Error(`the form “${f}” of ${p.id} already belongs to ${owner}`);
        formOwner.set(f.toLowerCase(), p.id);
      }
    }

    // Picos first: a new one is created; an existing one gets a new revision only if it gains implementing units.
    const picoRef = new Map();
    for (const p of digest.picos ?? []) {
      const current = nanos.get(p.id);
      const implementedBy = [...new Set([...(current?.implementedBy ?? []), ...(p.implementedBy ?? []).map(unit)])].sort();
      if (current) {
        if (current.kind !== 'definition') throw new Error(`${p.id} is a ${current.kind}, not a pico`);
        if (implementedBy.join() === (current.implementedBy ?? []).join()) { picoRef.set(p.id, current.ref); continue; }
        picoRef.set(p.id, addNano(db, { id: p.id, kind: 'definition', term: current.term, meaning: current.meaning, forms: current.forms,
                                        picos: current.picos, implementedBy, filedBy: current.filedBy, source }).ref);
      } else {
        addVocabulary(db, 'term', p.term, p.label);
        picoRef.set(p.id, addNano(db, { id: p.id, kind: 'definition', term: p.term, meaning: p.meaning, forms: p.forms, implementedBy, ...by }).ref);
      }
    }
    const allPicos = [...new Map([
      ...heldPicos(contracts, nanos).map(n => [n.id, { ref: n.ref, forms: n.forms }]),
      ...(digest.picos ?? []).map(p => [p.id, { ref: picoRef.get(p.id), forms: p.forms ?? nanos.get(p.id).forms }]),
    ]).values()];

    // Then each service: its purposes, its functional units, the claims that they serve the purposes, and its picos.
    const services = [];
    for (const s of digest.services ?? []) {
      const id = `service.${s.service}`;
      if (!contracts.has(id)) throw new Error(`no service ${s.service}`);
      const ref = new Map();
      for (const i of s.intents ?? [])
        ref.set(i.id, addNano(db, { id: i.id, kind: 'intent', statement: i.statement, picos: suggest(i.statement, allPicos), ...by }).ref);
      for (const n of s.nanos ?? [])
        ref.set(n.id, addNano(db, { id: n.id, kind: 'clause', role: n.role ?? 'platform', modality: n.modality ?? 'shall', text: n.text,
                                    implementedBy: (n.implementedBy ?? []).map(unit), picos: suggest(n.text, allPicos), ...by }).ref);
      const claims = [];
      for (const n of s.nanos ?? [])
        (n.serves ?? []).forEach((sv, k) => {
          const intent = ref.get(sv.intent) ?? nanos.get(sv.intent)?.ref;
          if (!intent) throw new Error(`${n.id} serves ${sv.intent}, which neither the digest nor the store holds`);
          claims.push(addNano(db, { id: `claim.${n.id}.${k + 1}`, kind: 'claim', from: ref.get(n.id), relation: 'supports', to: intent,
                                    strength: sv.strength ?? 'contributes', rationale: sv.rationale || 'Drafted in the digest of the service.', ...by }).ref);
        });
      const held = (s.picos ?? []).map(p => picoRef.get(p) ?? nanos.get(p)?.ref).filter(Boolean);
      const own = new Set(contracts.get(id).members);
      services.push(reviseContract(db, id, {
        addIntents: (s.intents ?? []).map(i => ({ ref: ref.get(i.id), ...(i.parent && { parent: ref.get(i.parent) ?? nanos.get(i.parent)?.ref }) })),
        add: [...new Set([...held, ...(s.nanos ?? []).map(n => ref.get(n.id)), ...claims])].filter(r => !own.has(r)),
        ...by,
      }).ref);
    }
    return services;
  })();
  // Finally each service's picos record the other picos their meanings use, by new revisions.
  for (const ref of revised) relinkContract(db, ref.split('@')[0], { filedBy: 'claude-draft', source: 'relinked to its picos by claude-draft' });
  return revised;
}

// Apply a digest to a throwaway copy of a store and say what it would add, or why it can't be applied.
export function tryApply(db, digest) {
  const copy = new Database(db.serialize());
  copy.pragma('foreign_keys = ON');
  const last = copy.prepare('SELECT max(rid) FROM revision').pluck().get();
  const services = apply(copy, digest);
  const kinds = copy.prepare('SELECT n.kind, count(*) AS n FROM revision r JOIN nano n ON n.id = r.nano_id WHERE r.rid > ? GROUP BY n.kind').all(last);
  return { services, revisions: Object.fromEntries(kinds.map(k => [k.kind, k.n])) };
}
