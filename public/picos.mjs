// Picos: strictly defined words. A word in a nano refers to a pico when it matches one of the pico's forms: the longest
// form wins, whole words only, case-insensitive. Shared by the viewer (public/app.js) and tools/picos.mjs, so the page and
// the tools always agree on what links where.

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    .filter(x => x.pico && x.pico.ref !== self);

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
