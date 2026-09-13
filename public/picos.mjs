// Picos: strictly defined words. A nano records which of its phrases refer to which pico revisions when it is written
// (nano.picos); rendering uses exactly those. Matching forms (the longest form wins, whole words only, case-insensitive)
// is for suggesting references while writing, and for finding a recorded phrase in a text when drawing it.

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idOf = ref => String(ref ?? '').split('@')[0];   // a pico never refers to itself, in any of its revisions

export function picoMatcher(picos) {
  const byForm = new Map(), collisions = [];
  for (const p of picos)
    for (const form of p.forms ?? [p.termLabel]) {
      const key = form.toLowerCase(), other = byForm.get(key);
      if (other && other.ref !== p.ref) collisions.push({ form: key, picos: [other.ref, p.ref] });
      byForm.set(key, p);
    }
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const pattern = forms.length ? new RegExp(`(?<![\\p{L}\\p{N}’'-])(${forms.join('|')})(?![\\p{L}\\p{N}’'-])`, 'giu') : null;

  // Every reference in plain text: [{ index, text, pico }]. `self` keeps a pico's own definition from linking to itself.
  const find = (text, self) => !pattern ? [] : [...String(text).matchAll(pattern)]
    .map(m => ({ index: m.index, text: m[0], pico: byForm.get(m[0].toLowerCase()) }))
    .filter(x => x.pico && idOf(x.pico.ref) !== idOf(self));

  // Plain text in, marked-up text out: `escape` for the plain parts, `wrap(escapedWord, pico)` for each reference.
  const render = (text, escape, wrap, self) => {
    let out = '', last = 0;
    for (const m of find(text, self)) {
      out += escape(text.slice(last, m.index)) + wrap(escape(m.text), m.pico);
      last = m.index + m.text.length;
    }
    return out + escape(text.slice(last));
  };

  return { picos, byForm, collisions, find, render };
}

// While writing: which picos the forms suggest for a text, as [{ phrase, pico }] ready to record with the nano.
// Suggestions only. A nano's references are recorded with its revision and never re-derived.
export function suggest(text, picos, self) {
  const seen = new Map();
  for (const x of picoMatcher(picos).find(text, self))
    if (!seen.has(x.text.toLowerCase())) seen.set(x.text.toLowerCase(), { phrase: x.text, pico: x.pico.ref });
  return [...seen.values()];
}

// Words that look like a pico's but don't link. A pico's key word is the longest word of its shortest form, its core
// ("mother thrives" → "thrives", "readiness" → "readiness"); a look-alike shares that word's first five letters.
// Worth checking the sense of each; the answer is either a new form or leaving it unlinked on purpose.
export function nearMisses(text, matcher) {
  const stems = new Map();
  for (const p of matcher.picos) {
    const core = (p.forms ?? [p.termLabel]).map(f => f.toLowerCase()).sort((a, b) => a.length - b.length)[0];
    const word = core.split(/\s+/).reduce((a, b) => (b.length >= a.length ? b : a), '');
    if (word.length < 5) continue;
    const stem = word.slice(0, 5);
    stems.set(stem, new Set([...(stems.get(stem) ?? []), p.ref]));
  }
  const linked = matcher.find(text).map(m => [m.index, m.index + m.text.length]);
  const out = [];
  for (const w of String(text).matchAll(/[\p{L}’'-]+/gu)) {
    const stem = w[0].slice(0, 5).toLowerCase();
    if (w[0].length < 5 || !stems.has(stem) || linked.some(([a, b]) => w.index >= a && w.index < b)) continue;
    out.push({ index: w.index, word: w[0], picos: [...stems.get(stem)] });
  }
  return out;
}
