// Why an intent has its coverage, in words, from the same inputs public/evaluate.mjs rolls up.
// Shared by the viewer's funnel and the graph view.

const RANK = { gap: 0, thin: 1, claimed: 2 };
import { short } from './common.mjs';

// `n` is a node of report.tree; `claims` is report.claims. Returns plain text.
export function coverageReason(n, claims) {
  const own = n.supports.map(ref => claims[ref]);
  const ownLevel = own.some(c => c.strength === 'sufficient') ? 'claimed' : own.length ? 'thin' : 'gap';
  if (ownLevel === 'claimed') return `Claimed: a sufficient claim supports it${own.length > 1 ? `, among ${own.length} supporting claims` : ''}.`;
  if (n.children.length) {
    const pick = n.children.reduce((a, b) => (n.combine === 'any' ? RANK[b.coverage] > RANK[a.coverage] : RANK[b.coverage] < RANK[a.coverage]) ? b : a);
    if (RANK[pick.coverage] >= RANK[ownLevel]) {
      if (n.coverage === 'claimed') return n.combine === 'any' ? 'Claimed: one of its parts is claimed.' : `Claimed: all ${n.children.length} of its parts are claimed.`;
      return `${n.coverage === 'thin' ? 'Thin' : 'Gap'}: it needs ${n.combine} of its parts, and “${short(pick.statement, 80)}” is ${pick.coverage === 'gap' ? 'a gap' : 'thin'}.`;
    }
  }
  return own.length ? `Thin: ${own.length} contributing claim${own.length > 1 ? 's' : ''}, none sufficient.` : 'Gap: nothing claims it yet.';
}
