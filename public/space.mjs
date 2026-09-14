// Demesnes: millis implemented on coordinate spaces, and the layers a viewer looks at them in.
//
// Picos, nanos, micros and millis are virtual; they take up no space. When the signatories of a milli implement it on a
// segment of a coordinate space, that is a demesne; its deme is whoever the milli defines. Demesnes nest: a demesne may be
// segmented exhaustively into others, or hold islands of others, and so on down. Which lies within which is computed
// here from the segments, never stored. A layer is what a viewer shows or hides: every demesne at one nesting level, or
// every demesne of one milli. Hiding a layer frees its visual cues for the layers below. Pure JavaScript, shared by the
// server, the static build and the browser.
//
// A segment is a GeoJSON Polygon or MultiPolygon in its space's frame (for Earth: longitude and latitude in degrees).
// Edges are straight in that frame, so a segment that crosses the antimeridian is written as two polygons.
import { latestById } from './common.mjs';

const EPS = 1e-9;

const polygonsOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
const ringsOf = g => polygonsOf(g).flat();
const edgesOf = ring => ring.slice(1).map((p, i) => [ring[i], p]);
const allEdges = g => ringsOf(g).flatMap(edgesOf);

export function checkSegment(g) {
  const fail = why => { throw Object.assign(new Error(`not a segment: ${why}`), { status: 400 }); };
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) fail('a segment is a GeoJSON Polygon or MultiPolygon');
  const polygons = polygonsOf(g);
  if (!Array.isArray(polygons) || !polygons.length) fail('it has no polygons');
  for (const poly of polygons) {
    if (!Array.isArray(poly) || !poly.length) fail('a polygon has no rings');
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4) fail('every ring needs at least four positions, the last repeating the first');
      if (!ring.every(p => Array.isArray(p) && p.length >= 2 && p.every(n => Number.isFinite(n)))) fail('every position is a pair of numbers');
      const [a, z] = [ring[0], ring.at(-1)];
      if (a[0] !== z[0] || a[1] !== z[1]) fail('every ring must end where it starts');
    }
  }
  // Simple rings, holes inside their outer ring: nesting, shares and stacking all assume them.
  for (const poly of polygons) {
    for (const ring of poly) {
      const edges = edgesOf(ring);
      for (let i = 0; i < edges.length; i++)
        for (let j = i + 2; j < edges.length; j++)
          if (!(i === 0 && j === edges.length - 1) && crosses(edges[i], edges[j])) fail('a ring crosses itself');
    }
    const outer = { type: 'Polygon', coordinates: [poly[0]] };
    for (const hole of poly.slice(1)) if (hole.slice(0, -1).some(p => locate(p, outer) < 0)) fail('a hole lies outside its ring');
  }
  return g;
}

export function bbox(g) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ringsOf(g).flat()) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return b;
}
const boxesMeet = (a, b) => a[0] <= b[2] + EPS && b[0] <= a[2] + EPS && a[1] <= b[3] + EPS && b[1] <= a[3] + EPS;

// Area in the frame's own units, holes subtracted. Exact for segments that share edges, so a segmentation's parts add
// up to the whole; used only for shares of a demesne, never as a measure of land.
const ringArea = ring => Math.abs(edgesOf(ring).reduce((s, [a, b]) => s + a[0] * b[1] - b[0] * a[1], 0)) / 2;
export const area = g => polygonsOf(g).reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0), 0);

const orient = (a, b, c) => {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(v) < EPS ? 0 : Math.sign(v);
};
const onEdge = (p, [a, b]) => orient(a, b, p) === 0
  && Math.min(a[0], b[0]) - EPS <= p[0] && p[0] <= Math.max(a[0], b[0]) + EPS
  && Math.min(a[1], b[1]) - EPS <= p[1] && p[1] <= Math.max(a[1], b[1]) + EPS;
// Two edges cross properly: each passes strictly through the other. Touching and running along each other don't count.
const crosses = ([a, b], [c, d]) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;

const inRing = ([x, y], ring) => {
  let inside = false;
  for (const [[x1, y1], [x2, y2]] of edgesOf(ring))
    if ((y1 > y) !== (y2 > y) && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  return inside;
};

// Where a point [x, y] lies relative to a segment: 1 inside, 0 on its boundary, -1 outside (holes are outside).
export function locate(p, g) {
  for (const poly of polygonsOf(g)) {
    if (poly.some(ring => edgesOf(ring).some(e => onEdge(p, e)))) return 0;
    if (inRing(p, poly[0]) && !poly.slice(1).some(hole => inRing(p, hole))) return 1;
  }
  return -1;
}

// The points that stand for a segment when comparing it with another: its vertices and the middle of every edge.
const probes = g => ringsOf(g).flatMap(ring => edgesOf(ring).flatMap(([a, b]) => [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]));

// How segment a lies relative to segment b: 'within', 'contains', 'equal', 'overlaps', 'touches' (shares only boundary)
// or 'disjoint'.
export function relate(a, b) {
  if (!boxesMeet(bbox(a), bbox(b))) return 'disjoint';
  const eb = allEdges(b);
  const crossing = allEdges(a).some(e => eb.some(f => crosses(e, f)));
  const aInB = probes(a).map(p => locate(p, b)), bInA = probes(b).map(p => locate(p, a));
  if (!crossing) {
    const aWithin = aInB.every(x => x >= 0) && bInA.every(x => x <= 0);
    const bWithin = bInA.every(x => x >= 0) && aInB.every(x => x <= 0);
    if (aWithin && bWithin) return 'equal';
    if (aWithin) return 'within';
    if (bWithin) return 'contains';
  }
  if (crossing || aInB.some(x => x > 0) || bInA.some(x => x > 0)) return 'overlaps';
  return aInB.some(x => x === 0) || bInA.some(x => x === 0) ? 'touches' : 'disjoint';
}
const INVERSE = { within: 'contains', contains: 'within', equal: 'equal', overlaps: 'overlaps', touches: 'touches', disjoint: 'disjoint' };

// The latest revision of each demesne.
export const currentDemesnes = demesnes => [...latestById(demesnes).values()];

// Every current demesne on a coordinate space, from the outermost to the innermost, each with:
//   level        its nesting level: 1 for a demesne within no other, 2 within one, and so on
//   within       the demesnes it lies within, outermost first; parent, the one it lies directly within
//   children     the demesnes lying directly within it, and segmentation: whether they segment it exhaustively
//                ('exhaustive'), cover a share of it ('partial', as islands or a partial segmentation) or overlap
//                one another ('overlapping')
//   overlaps, touches, shares   demesnes it overlaps, only borders, or shares its exact segment with
//   meets        every demesne it isn't disjoint from
export function layering(demesnes, space) {
  const here = currentDemesnes(demesnes).filter(d => d.space === space);
  const rel = new Map(here.map(d => [d.ref, new Map()]));
  for (let i = 0; i < here.length; i++)
    for (let j = i + 1; j < here.length; j++) {
      const r = relate(here[i].segment, here[j].segment);
      rel.get(here[i].ref).set(here[j].ref, r);
      rel.get(here[j].ref).set(here[i].ref, INVERSE[r]);
    }
  const as = (d, ...kinds) => here.filter(o => kinds.includes(rel.get(d.ref).get(o.ref))).map(o => o.ref);
  const depth = new Map(here.map(d => [d.ref, as(d, 'within').length]));
  const items = here.map(d => {
    const within = as(d, 'within').sort((a, b) => depth.get(a) - depth.get(b));
    return { ...d, depth: within.length, level: within.length + 1, within, parent: within.at(-1) ?? null,
             overlaps: as(d, 'overlaps'), touches: as(d, 'touches'), shares: as(d, 'equal'),
             meets: as(d, 'within', 'contains', 'equal', 'overlaps', 'touches') };
  });
  for (const d of items) {
    const children = items.filter(c => c.parent === d.ref);
    d.children = children.map(c => c.ref);
    if (!children.length) { d.segmentation = null; continue; }
    const overlapping = children.some(c => [...c.overlaps, ...c.shares, ...c.within].some(o => d.children.includes(o)));
    const covered = children.reduce((s, c) => s + area(c.segment), 0) / area(d.segment);
    d.segmentation = overlapping ? { kind: 'overlapping', share: null }
      : { kind: covered >= 1 - 1e-9 ? 'exhaustive' : 'partial', share: Math.min(covered, 1) };
  }
  return items.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
}

// The demesnes stacked on an area of interest, a point [x, y] or a segment, from the outermost to the innermost.
export function stackAt(layered, area) {
  return layered.filter(d => (Array.isArray(area) ? locate(area, d.segment) >= 0 : !['disjoint', 'touches'].includes(relate(area, d.segment))));
}

// The layers a viewer can show or hide: every demesne at one nesting level ('level'), or every demesne of one milli
// ('milli'), outermost first.
export function layersOf(layered, by = 'level') {
  const layers = new Map();
  for (const d of layered) {
    const key = by === 'milli' ? d.milli.split('@')[0] : String(d.level);
    if (!layers.has(key)) layers.set(key, { key, label: by === 'milli' ? d.milliTitle : `Layer ${d.level}`, demesnes: [] });
    layers.get(key).demesnes.push(d.ref);
  }
  return [...layers.values()];
}

// Visual cues for the layers shown. Each shown layer takes a pattern by its rank among them, so hiding a layer frees
// its pattern for the layers below. Within a layer, demesnes that meet take different colours (greedy map colouring:
// a map of neighbours rarely needs more than four). Returns ref → { pattern, colour }, both indices from 0.
export function paint(layered, layers, shown) {
  const byRef = new Map(layered.map(d => [d.ref, d]));
  const cues = new Map();
  layers.filter(l => shown.has(l.key)).forEach((layer, rank) => {
    const inLayer = new Set(layer.demesnes);
    const neighbours = d => d.meets.filter(m => inLayer.has(m));
    const members = layer.demesnes.map(ref => byRef.get(ref))
      .sort((a, b) => neighbours(b).length - neighbours(a).length || a.name.localeCompare(b.name));
    for (const d of members) {
      const taken = new Set(neighbours(d).filter(m => cues.has(m)).map(m => cues.get(m).colour));
      let colour = 0;
      while (taken.has(colour)) colour++;
      cues.set(d.ref, { pattern: rank, colour });
    }
  });
  return cues;
}
