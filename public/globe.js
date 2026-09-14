// The Globe: demesnes, which are millis implemented on segments of a coordinate space, drawn on the globe in layers the
// viewer shows or hides. A layer is every demesne at one nesting level, or every demesne of one milli. Each shown layer
// has its own ground pattern, and neighbouring demesnes within it differ in colour. Hiding the layers above frees their
// patterns for the layers below, where deeper demesnes show as islands. Click anywhere to list every demesne stacked
// there. State lives in the URL (?space=…&by=level|milli&hide=<layers>&at=<x>,<y>&example=0|1), so a view can be linked.
import { findSource } from './source.mjs';
import { layering, layersOf, paint, stackAt, bbox } from './space.mjs';
import { EXAMPLE } from './example-demesnes.mjs';

const $ = selector => document.querySelector(selector);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n).toFixed(4);
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// Colours tell neighbouring demesnes within a layer apart; patterns tell the layers apart: a tint for the first layer
// shown, then hatchings. The four colours pass colour-vision separation for every pair against a light ground, and the
// map's ground (the base map) stays light in either theme. Each demesne is also named in the panel and outlined.
const COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'];
const PATTERNS = ['tint', 'hatch', 'counter-hatch', 'lines', 'dots'];
const SIZE = 12;
const INKED = {
  'tint': () => true,
  'hatch': (x, y) => (x + y) % 6 < 2,
  'counter-hatch': (x, y) => (x - y + SIZE) % 6 < 2,
  'lines': (x, y) => y % 6 < 2,
  'dots': (x, y) => x % 6 < 3 && y % 6 < 3,
};

function pattern(kind, hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) data.set([r, g, b, INKED[kind](x, y) ? (kind === 'tint' ? 72 : 225) : 0], (y * SIZE + x) * 4);
  return { width: SIZE, height: SIZE, data };
}

const swatchUrls = new Map();
function swatchUrl(kind, hex) {
  const key = kind + hex;
  if (!swatchUrls.has(key)) {
    const canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pattern(kind, hex).data), SIZE, SIZE), 0, 0);
    swatchUrls.set(key, canvas.toDataURL());
  }
  return swatchUrls.get(key);
}
const swatch = cue => `<span class="swatch" aria-hidden="true"${cue ? ` style="background-image:url(${swatchUrl(cue.kind, cue.hex)})"` : ''}></span>`;

// ─── State ───────────────────────────────────────────────────────────────────

const state = { space: 'earth', by: 'level', hidden: new Set(), at: null, example: null };
let data, map, marker, layered = [], layers = [], cues = new Map();

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.space = q.get('space') ?? 'earth';
  state.by = q.get('by') === 'milli' ? 'milli' : 'level';
  state.hidden = new Set((q.get('hide') ?? '').split(',').filter(Boolean));
  const at = (q.get('at') ?? '').split(',').map(Number);
  state.at = at.length === 2 && at.every(Number.isFinite) ? at : null;
  state.example = q.has('example') ? q.get('example') === '1' : null;   // unset: shown while Earth has no demesnes
}

function writeUrl() {
  const q = new URLSearchParams({ space: state.space, by: state.by });
  if (state.hidden.size) q.set('hide', [...state.hidden].join(','));
  if (state.at) q.set('at', state.at.map(fmt).join(','));
  if (state.example !== null) q.set('example', state.example ? '1' : '0');
  history.replaceState(null, '', `?${q}`);
}

const showingExample = () => state.space === 'earth' && (state.example ?? !data.demesnes.some(d => d.space === 'earth'));

function compute() {
  layered = layering([...data.demesnes, ...(showingExample() ? EXAMPLE : [])], state.space);
  layers = layersOf(layered, state.by);
  cues = paint(layered, layers, new Set(layers.map(l => l.key).filter(key => !state.hidden.has(key))));
}

const cueOf = ref => {
  const c = cues.get(ref);
  // Map colouring can need a fifth colour; rather than wrap onto a neighbour's, a fifth or later one is drawn dashed.
  return c && { kind: PATTERNS[c.pattern % PATTERNS.length], hex: COLOURS[c.colour % COLOURS.length], dashed: c.colour >= COLOURS.length };
};

// ─── The globe ───────────────────────────────────────────────────────────────

const OSM = {
  type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
// Earth has a base map; any other body is drawn as a bare globe in its own frame.
const styleFor = space => ({
  version: 8,
  sources: space === 'earth' ? { osm: OSM } : {},
  layers: [
    { id: 'ground', type: 'background', paint: { 'background-color': '#d9ddd4' } },
    ...(space === 'earth' ? [{ id: 'osm', type: 'raster', source: 'osm' }] : []),
  ],
});

function features() {
  return {
    type: 'FeatureCollection',
    features: layered.filter(d => cues.has(d.ref)).map(d => {
      const cue = cueOf(d.ref), image = `${cue.kind}-${cue.hex.slice(1)}`;
      if (!map.hasImage(image)) map.addImage(image, pattern(cue.kind, cue.hex));
      return { type: 'Feature', geometry: d.segment, properties: { ref: d.ref, depth: d.depth, image, line: cue.hex, dashed: cue.dashed } };
    }),
  };
}

// On every style load: the first, and after a change of coordinate space.
function addDemesnes() {
  map.setProjection({ type: 'globe' });
  map.addSource('demesnes', { type: 'geojson', data: features() });
  map.addLayer({ id: 'demesne-fill', type: 'fill', source: 'demesnes', layout: { 'fill-sort-key': ['get', 'depth'] },
                 paint: { 'fill-pattern': ['get', 'image'] } });
  map.addLayer({ id: 'demesne-line', type: 'line', source: 'demesnes', filter: ['!', ['get', 'dashed']], layout: { 'line-sort-key': ['get', 'depth'] },
                 paint: { 'line-color': ['get', 'line'], 'line-width': 1.5 } });
  map.addLayer({ id: 'demesne-line-dashed', type: 'line', source: 'demesnes', filter: ['get', 'dashed'], layout: { 'line-sort-key': ['get', 'depth'] },
                 paint: { 'line-color': ['get', 'line'], 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
}

function placeMarker() {
  marker?.remove();
  marker = null;
  if (!state.at) return;
  const el = Object.assign(document.createElement('div'), { className: 'here-marker' });
  marker = new maplibregl.Marker({ element: el }).setLngLat(state.at).addTo(map);
}

function fit() {
  if (state.at) return map.jumpTo({ center: state.at, zoom: Math.max(map.getZoom(), 5) });
  if (!layered.length) return map.jumpTo({ center: [-30, 25], zoom: 1.3 });
  const b = layered.map(d => bbox(d.segment))
    .reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 110, maxZoom: 10, duration: 0 });   // with room to see where on the globe
}

// ─── The panel ───────────────────────────────────────────────────────────────

const spaceOf = id => data.spaces.find(s => s.id === id) ?? { id, label: id, frame: '' };
const nameOf = ref => esc(layered.find(d => d.ref === ref)?.name ?? ref);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = x => (x < 0.01 ? 'under 1%' : `${Math.round(x * 100)}%`);
const milli = d => d.example
  ? `${esc(d.milliTitle)} <span class="ref">example</span>`
  : `<a href="./?contract=${encodeURIComponent(d.milli.split('@')[0])}">${esc(d.milliTitle)}</a> <span class="ref">${esc(d.milli)}</span>`;

function segmentation(d) {
  const s = d.segmentation, n = d.children.length;
  if (!s) return '';
  if (s.kind === 'exhaustive') return `segmented exhaustively into ${plural(n, 'demesne')}`;
  if (s.kind === 'overlapping') return `the ${plural(n, 'demesne')} within it overlap one another`;
  return `${plural(n, 'demesne')} within it cover ${pct(s.share)}`;
}

function item(d) {
  const cue = cueOf(d.ref);
  const notes = [
    `nesting level ${d.level}`,
    d.parent ? `within ${nameOf(d.parent)}` : '',
    d.overlaps.length ? `overlaps ${d.overlaps.map(nameOf).join(', ')}` : '',
    d.shares.length ? `on the same segment as ${d.shares.map(nameOf).join(', ')}` : '',
    segmentation(d),
    cue ? '' : 'its layer is hidden',
  ].filter(Boolean).join(' · ');
  return `<li style="--depth:${d.depth}"${cue ? '' : ' class="is-hidden"'}>
    <span class="demesne-head">${swatch(cue)}<strong>${esc(d.name)}</strong></span>
    <span>implements ${milli(d)}</span>
    <span class="stack-note">${notes}</span>
  </li>`;
}

// Every demesne as a tree: each followed by the demesnes lying directly within it.
function treeOrder() {
  const out = [];
  const visit = d => { out.push(d); layered.filter(c => c.parent === d.ref).forEach(visit); };
  layered.filter(d => !d.parent).forEach(visit);
  return out;
}

function layersHtml() {
  const shown = layers.filter(l => !state.hidden.has(l.key));
  const ink = token('--ink-2', '#4d5650');
  const rows = layers.map(l => {
    const rank = shown.indexOf(l);
    return `<li><label>
      <input type="checkbox" data-layer="${esc(l.key)}"${rank >= 0 ? ' checked' : ''}>
      ${swatch(rank >= 0 ? { kind: PATTERNS[rank % PATTERNS.length], hex: ink } : null)}
      <span>${esc(l.label)}</span><span class="n">${l.demesnes.length}</span>
    </label></li>`;
  }).join('');
  return `<section>
    <h2>Layers</h2>
    <label class="field" for="by">Layers by
      <select id="by"><option value="level">nesting level</option><option value="milli">milli</option></select>
    </label>
    ${layers.length ? `<ul class="layer-toggles">${rows}</ul>` : '<p class="empty">Layers appear once there are demesnes.</p>'}
    ${shown.length > PATTERNS.length ? `<p class="detail-note">More than ${PATTERNS.length} layers are shown, so their patterns repeat: hide some to tell them apart.</p>` : ''}
    ${state.space === 'earth' ? `<label class="example-toggle"><input type="checkbox" id="example"${showingExample() ? ' checked' : ''}> Show the example demesnes</label>` : ''}
  </section>`;
}

function panel() {
  const space = spaceOf(state.space);
  const note = showingExample()
    ? '<p class="proposal-note">Showing example demesnes, which are not in the catalogue: a defensive military demesne segmented exhaustively into four cultural demesnes, with islands of other demesnes within them, and an island within an island.</p>'
    : '';
  let body;
  if (state.at) {
    const here = stackAt(layered, state.at);
    body = `<section>
      <h2>Stacked here</h2>
      <p class="detail-note">${fmt(state.at[0])}, ${fmt(state.at[1])} on ${esc(space.label)}, in ${esc(space.frame)}</p>
      ${here.length ? `<ol class="stack">${here.map(item).join('')}</ol>` : '<p class="empty">No demesne lies here.</p>'}
      <p><button type="button" class="btn" id="clear">List every demesne</button></p>
    </section>`;
  } else {
    body = `<section>
      <h2>Demesnes on ${esc(space.label)}</h2>
      <p class="detail-note">A demesne is a milli implemented on a segment of a coordinate space. Click anywhere on the globe to list every demesne stacked there.</p>
      ${layered.length ? `<ol class="stack">${treeOrder().map(item).join('')}</ol>` : `<p class="empty">No milli has been implemented on ${esc(space.label)} yet.</p>`}
    </section>`;
  }
  $('#details').innerHTML = layersHtml() + note + body;
  $('#by').value = state.by;
}

function refresh({ refit = false } = {}) {
  compute();
  map.getSource('demesnes')?.setData(features());
  placeMarker();
  panel();
  writeUrl();
  if (refit) fit();
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  readUrl();
  try {
    data = await (await findSource()).demesnes();
  } catch (err) {
    $('#details').innerHTML = `<p class="notice error">${esc(err.message)}</p>`;
    return;
  }
  if (!data.spaces.some(s => s.id === state.space)) state.space = data.spaces[0]?.id ?? 'earth';
  $('#space').innerHTML = data.spaces.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
  $('#space').value = state.space;
  compute();
  panel();
  writeUrl();

  map = new maplibregl.Map({ container: 'map', style: styleFor(state.space), center: [-30, 25], zoom: 1.3, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.on('style.load', addDemesnes);
  map.once('load', () => { placeMarker(); fit(); });
  map.on('click', e => { const p = e.lngLat.wrap(); state.at = [p.lng, p.lat]; refresh(); });

  $('#space').addEventListener('change', e => {
    state.space = e.target.value;
    state.at = null;
    state.hidden.clear();
    compute();
    map.setStyle(styleFor(state.space));   // its style.load draws the demesnes again
    placeMarker();
    panel();
    writeUrl();
    fit();
  });
  $('#details').addEventListener('change', e => {
    const t = e.target, key = t.dataset.layer;
    if (key) t.checked ? state.hidden.delete(key) : state.hidden.add(key);
    else if (t.id === 'by') { state.by = t.value; state.hidden.clear(); }
    else if (t.id === 'example') state.example = t.checked;
    else return;
    refresh({ refit: t.id === 'example' });
    $(key ? `[data-layer="${CSS.escape(key)}"]` : `#${t.id}`)?.focus();   // the panel was redrawn; keep keyboard focus
  });
  $('#details').addEventListener('click', e => {
    if (e.target.closest('#clear')) { state.at = null; refresh(); }
  });
}

main();
