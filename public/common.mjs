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

// The page's colours, read from its theme's tokens, for what draws on a canvas.
export function palette() {
  const s = getComputedStyle(document.documentElement), v = name => s.getPropertyValue(name).trim();
  return { ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), rule: v('--rule-strong'), surface: v('--surface'), ground: v('--ground'),
           accent: v('--accent'), claimed: v('--claimed'), thin: v('--thin'), gap: v('--gap') };
}
