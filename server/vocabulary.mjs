// The composer's own vocabulary: picos in the platform's store (store/system.sqlite), the same structure as the
// catalogue's. The guide's glossary is rendered from them, so a word is changed once, as a new pico revision, and
// every meaning that uses it links to it by its recorded reference. Nothing here is written by hand.
import { readFileSync } from 'node:fs';
import { catalogue } from './store.mjs';
import { picoMatcher } from '../public/picos.mjs';

export const GUIDE = new URL('../public/guide.html', import.meta.url);
const START = '<!-- vocabulary:start';
const END = '<!-- vocabulary:end -->';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const anchor = ref => `term-${String(ref).split('@')[0]}`;
const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

// Every pico of the vocabulary micro, in its order. Each meaning links the words it was written with to their picos,
// by the references recorded with it, and shows the linked pico's current meaning on hover. Definitions refer to one
// another in cycles, so pinned references among them can't all be current at once. A contract keeps its pinned meaning
// because signatures rest on it; the platform's own copy has no signatures, so it follows each pico's latest revision.
export function renderGlossary(db) {
  const cat = catalogue(db);
  const latest = new Map();
  for (const n of Object.values(cat.nanos)) if (!latest.has(n.id) || latest.get(n.id).rev < n.rev) latest.set(n.id, n);
  const current = ref => latest.get(String(ref).split('@')[0]);
  const vocabulary = Object.values(cat.contracts).filter(c => c.id === 'vocabulary').sort((a, b) => b.rev - a.rev)[0];
  if (!vocabulary) throw new Error('the system store has no vocabulary micro');
  return vocabulary.members.map(ref => cat.nanos[ref]).filter(n => n.kind === 'definition').map(p => {
    const meaning = p.picos.length
      ? picoMatcher(p.picos.map(r => ({ ref: r.pico, forms: [r.phrase] })))
        .render(p.meaning, esc, (html, q) => `<a class="term" href="#${anchor(q.ref)}" title="${esc(current(q.ref).meaning)}">${html}</a>`)
      : esc(p.meaning);
    return `          <div id="${anchor(p.ref)}"><dt>${esc(capital(p.termLabel))}</dt><dd>${meaning}</dd></div>`;
  }).join('\n');
}

// The guide as it should be: its glossary region replaced by what the picos render.
export function syncedGuide(db, html = readFileSync(GUIDE, 'utf8')) {
  const start = html.indexOf(START), end = html.indexOf(END);
  if (start < 0 || end < start) throw new Error('public/guide.html has no vocabulary region');
  const open = html.indexOf('-->', start) + 3;
  return `${html.slice(0, open)}\n${renderGlossary(db)}\n          ${html.slice(end)}`;
}
