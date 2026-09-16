// Drawing demesnes on a globe: the cues that tell layers and neighbours apart, and the MapLibre pieces the views draw
// with. The Globe and the Timeline both use these, so one demesne looks the same in either.
//
// Colours tell neighbouring demesnes within a layer apart; patterns tell the layers apart: a tint for the first layer
// shown, then hatchings. The four colours pass colour-vision separation for every pair against a light ground, and the
// map's ground (the base map) stays light in either theme.
import { LAND } from './land.mjs';

export const COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'];
export const PATTERNS = ['tint', 'hatch', 'counter-hatch', 'lines', 'dots'];
const SIZE = 12;
const INKED = {
  'tint': () => true,
  'hatch': (x, y) => (x + y) % 6 < 2,
  'counter-hatch': (x, y) => (x - y + SIZE) % 6 < 2,
  'lines': (x, y) => y % 6 < 2,
  'dots': (x, y) => x % 6 < 3 && y % 6 < 3,
};

export function pattern(kind, hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) data.set([r, g, b, INKED[kind](x, y) ? (kind === 'tint' ? 72 : 225) : 0], (y * SIZE + x) * 4);
  return { width: SIZE, height: SIZE, data };
}

const swatchUrls = new Map();
export function swatchUrl(kind, hex) {
  const key = kind + hex;
  if (!swatchUrls.has(key)) {
    const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pattern(kind, hex).data), SIZE, SIZE), 0, 0);
    swatchUrls.set(key, canvas.toDataURL());
  }
  return swatchUrls.get(key);
}
export const swatch = cue => `<span class="swatch" aria-hidden="true"${cue ? ` style="background-image:url(${swatchUrl(cue.kind, cue.hex)})"` : ''}></span>`;

// A demesne's cue, from what paint() worked out. Map colouring can need a fifth colour; rather than wrap onto a
// neighbour's, a fifth or later one is drawn dashed.
export const cueOf = (cues, ref) => {
  const c = cues.get(ref);
  return c && { kind: PATTERNS[c.pattern % PATTERNS.length], hex: COLOURS[c.colour % COLOURS.length], dashed: c.colour >= COLOURS.length };
};

const OSM = {
  type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
// A view standing at an instant takes no base map of today: its countries, cities and roads are of today, and over a
// demesne of 323 BC they say nothing true. What it keeps is the coastline, drawn from land we ship ourselves, so the
// page depends on nobody's tiles and nothing on it is a name.
const WATER = '#cfdce4', SHORE = '#e9e7dc', COAST = '#b4b9aa';
const outline = {
  type: 'geojson', data: { type: 'Feature', properties: {}, geometry: LAND },
  attribution: 'Land: <a href="https://www.naturalearthdata.com/">Natural Earth</a>, public domain',
};

// Earth has a base map where a view stands in the present; at an instant it has the coastline alone, and any other
// body is drawn as a bare globe in its own frame.
export const styleFor = (space, { labels = true } = {}) => {
  if (space !== 'earth') return { version: 8, sources: {}, layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#d9ddd4' } }] };
  if (labels) {
    return { version: 8, sources: { base: OSM },
             layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#d9ddd4' } },
                      { id: 'base', type: 'raster', source: 'base' }] };
  }
  return {
    version: 8,
    sources: { land: outline },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': WATER } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': SHORE } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': COAST, 'line-width': 0.8 } },
    ],
  };
};

// The demesnes to draw, as GeoJSON, registering each pattern with the map as it is first used.
export function featuresOf(map, layered, cues) {
  return {
    type: 'FeatureCollection',
    features: layered.filter(d => cues.has(d.ref)).map(d => {
      const cue = cueOf(cues, d.ref), image = `${cue.kind}-${cue.hex.slice(1)}`;
      if (!map.hasImage(image)) map.addImage(image, pattern(cue.kind, cue.hex));
      return { type: 'Feature', geometry: d.segment, properties: { ref: d.ref, depth: d.depth, image, line: cue.hex, dashed: cue.dashed } };
    }),
  };
}

// On every style load: the first, and after a change of coordinate space.
export function addDemesneLayers(map, data) {
  map.setProjection({ type: 'globe' });
  map.addSource('demesnes', { type: 'geojson', data });
  map.addLayer({ id: 'demesne-fill', type: 'fill', source: 'demesnes', layout: { 'fill-sort-key': ['get', 'depth'] },
                 paint: { 'fill-pattern': ['get', 'image'] } });
  map.addLayer({ id: 'demesne-line', type: 'line', source: 'demesnes', filter: ['!', ['get', 'dashed']], layout: { 'line-sort-key': ['get', 'depth'] },
                 paint: { 'line-color': ['get', 'line'], 'line-width': 1.5 } });
  map.addLayer({ id: 'demesne-line-dashed', type: 'line', source: 'demesnes', filter: ['get', 'dashed'], layout: { 'line-sort-key': ['get', 'depth'] },
                 paint: { 'line-color': ['get', 'line'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
}
