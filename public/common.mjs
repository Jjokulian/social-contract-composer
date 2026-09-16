// Helpers every page and module shares, each defined once. The platform's digest found them copied into up to six
// files, with different defaults; one definition means one meaning, and one place to change it.

// Text made safe to put in HTML: shown, never run.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Text cut to at most max characters, an ellipsis marking the cut.
export const short = (s, max) => ((s = String(s ?? '')).length > max ? `${s.slice(0, max - 1)}…` : s);

// The id of a reference, without its revision: fatal-risk.pro-pregnancy@3 → fatal-risk.pro-pregnancy.
export const nanoId = ref => String(ref).split('@')[0];

// The latest revision of each id among nanos or contracts: id → the revision.
export const latestById = list => { const by = new Map(); for (const x of list) if (!by.has(x.id) || by.get(x.id).rev < x.rev) by.set(x.id, x); return by; };

// The first element matching a selector, in the page or within root.
export const $ = (selector, root = document) => root.querySelector(selector);

// What a contract is, beside where it stands: one to compose with now, a record of what was, or an example that shows
// the structure and was never signed. A view shows the proposed ones unless its address asks for more, so historical
// and fictive material never drifts into a composition unless it is asked for.
export const CASES = { proposed: 'Proposed', historical: 'Historical', fictive: 'Fictive' };

// The views that compose show the proposed contracts unless asked for more; the views that look at what was — the Globe
// and the Timeline — show every case, which is what they are for.
export function casesOf(search, fallback = ['proposed']) {
  const asked = (new URLSearchParams(search).get('case') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (asked.includes('all')) return new Set(Object.keys(CASES));
  const known = asked.filter(c => c in CASES);
  return new Set(known.length ? known : fallback);
}

// Whether a contract or a demesne is one of the cases shown; anything that doesn't say is proposed.
export const inCase = (x, cases) => cases.has(x?.case ?? 'proposed');

// The cases as an address asks for them, or nothing where only the proposed ones are shown, which is the default.
export const caseParam = cases => {
  const list = [...cases].sort();
  return list.length === 1 && list[0] === 'proposed' ? null : list.join(',');
};

// The page's colours, read from its theme's tokens, for what draws on a canvas.
export function palette() {
  const s = getComputedStyle(document.documentElement), v = name => s.getPropertyValue(name).trim();
  return { ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), rule: v('--rule-strong'), surface: v('--surface'), ground: v('--ground'),
           accent: v('--accent'), claimed: v('--claimed'), thin: v('--thin'), gap: v('--gap') };
}
