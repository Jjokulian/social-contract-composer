// The timeline of demesnes: what a set of them spans, how many were in force at each instant across it, and what
// happened — a demesne began, a demesne ended, one came after another. Pure JavaScript, shared by the Timeline view and
// the tests; the drawing is in public/time.js.
import { instant, inForce, currentDemesnes } from './space.mjs';


const YEAR = 372;   // instants count in days of twelve 31-day months, so a year is 372 of them (public/space.mjs)

// The span the recorded periods cover, with room before the first and after the last. Null where none is recorded.
export function extent(demesnes) {
  const bounds = [];
  for (const d of currentDemesnes(demesnes)) {
    const from = d.from && instant(d.from), until = d.until && instant(d.until);
    if (from) bounds.push(from.start);
    if (until) bounds.push(until.end);
  }
  if (!bounds.length) return null;
  const start = Math.min(...bounds), end = Math.max(...bounds);
  const pad = Math.max(YEAR, Math.round((end - start) * 0.08));
  return { start: start - pad, end: end + pad };
}

// The level a demesne lay at, at one instant: one, and one more for every demesne in force then that contains it.
// Which demesnes contain which follows from the segments and is worked out once (public/space.mjs); which of them were
// in force changes with the instant, so the nesting counted here is the nesting as it was then, not as it ever was.
export const levelAt = (ref, containers, inForceNow) =>
  1 + [...(containers.get(ref) ?? [])].filter(other => inForceNow.has(other)).length;

// How many demesnes were in force at each of `steps` instants across the span, counted at the level each lay at then.
export function samples(demesnes, { start, end }, containers, steps = 180) {
  const here = currentDemesnes(demesnes);
  const out = [];
  for (let i = 0; i < steps; i++) {
    const at = Math.round(start + (end - start) * (steps === 1 ? 0 : i / (steps - 1)));
    const now = here.filter(d => inForce(d, { start: at, end: at }));
    const inForceNow = new Set(now.map(d => d.ref));
    const byLevel = [];
    for (const d of now) {
      const k = levelAt(d.ref, containers, inForceNow) - 1;
      byLevel[k] = (byLevel[k] ?? 0) + 1;
    }
    out.push({ at, byLevel: Array.from(byLevel, n => n ?? 0), total: now.length });
  }
  return out;
}

// What happened, in time order: a demesne began, a demesne ended, one came after another.
export function eventsOf(demesnes) {
  const events = [];
  for (const d of currentDemesnes(demesnes)) {
    const from = d.from && instant(d.from), until = d.until && instant(d.until);
    if (from) events.push({ at: from.start, kind: 'began', ref: d.ref, name: d.name, when: d.from });
    if (from && d.after) events.push({ at: from.start, kind: 'after', ref: d.ref, name: d.name, when: d.from, other: d.after });
    if (until) events.push({ at: until.end, kind: 'ended', ref: d.ref, name: d.name, when: d.until });
  }
  return events.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref));
}

// Round years to mark a span with, at most `most` of them.
const STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
export function ticksOf({ start, end }, most = 8) {
  const first = Math.ceil(start / YEAR), last = Math.floor(end / YEAR);
  const step = STEPS.find(s => (last - first) / s <= most) ?? STEPS.at(-1);
  const out = [];
  for (let year = Math.ceil(first / step) * step; year <= last; year += step) out.push({ at: year * YEAR, year });
  return out;
}

// A year as it is spoken: 1789, or 323 BC. Year 0 is the year before 1, as astronomers count it.
export const yearLabel = year => (year < 0 ? `${-year} BC` : String(year));
