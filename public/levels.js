// The Levels view: every milli, micro, nano and pico of a store as one graph, with the composing operators and the other
// relations between them (public/levels.mjs computes it). Filter by level and by relation; a hidden level is crossed,
// not cut. State lives in the URL (?store=…&scope=…&levels=…&relations=…&revisions=apart), so a view can be linked.
import { findSource, storeOf, STORES } from './source.mjs';
import { buildGraph, filterGraph, LEVELS, RELATIONS } from './levels.mjs';
import { $, esc, palette, latestById } from './common.mjs';


const store = storeOf(location.search);
const query = new URLSearchParams(location.search);
const list = (param, allowed, fallback) => new Set((query.get(param) ?? fallback).split(',').filter(x => Object.hasOwn(allowed, x)));
const state = {
  scope: query.get('scope') ?? 'all',
  levels: list('levels', LEVELS, store === 'system' ? 'milli,micro' : 'milli,micro,nano'),   // the platform: its services and files
  relations: list('relations', RELATIONS, Object.keys(RELATIONS).join(',')),
  revisions: query.get('revisions') === 'apart' ? 'apart' : 'merge',
};
let cat, cy;
let dense = false;   // a large graph: laid out in bands, drawn with straight, unlabelled connections

function writeUrl() {
  const q = new URLSearchParams();
  if (store !== 'catalogue') q.set('store', store);
  if (state.scope !== 'all') q.set('scope', state.scope);
  q.set('levels', [...state.levels].join(','));
  if (state.relations.size !== Object.keys(RELATIONS).length) q.set('relations', [...state.relations].join(','));
  if (state.revisions === 'apart') q.set('revisions', 'apart');
  history.replaceState(null, '', `?${q}`);
}

try { cytoscape.use(window.cytoscapeDagre); } catch { /* already registered by its own script */ }
const LAYOUT = (() => { try { return cytoscape('layout', 'dagre'); } catch { return null; } })()
  ? { name: 'dagre', rankDir: 'TB', ranker: 'network-simplex', nodeSep: 14, rankSep: 80, edgeSep: 6, animate: false }
  : { name: 'breadthfirst', directed: true };

// ─── Drawing ─────────────────────────────────────────────────────────────────

const SERIF = 'Source Serif 4, Georgia, serif', SANS = 'IBM Plex Sans, system-ui, sans-serif', MONO = 'IBM Plex Mono, monospace';
const edgeLabel = t => ({ label: 'data(label)', 'font-family': SANS, 'font-size': 10, color: t.ink2,
                          'text-background-color': t.surface, 'text-background-opacity': 1, 'text-background-padding': 2, 'text-rotation': 'autorotate' });
const style = (t, dense = false) => [
  { selector: 'node', style: {
    label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 150, 'font-family': SERIF, 'font-size': 11, color: t.ink,
    'text-valign': 'center', 'text-halign': 'center', 'background-color': t.surface, 'border-width': 1.5, 'border-color': t.rule,
    shape: 'round-rectangle', width: 'label', height: 'label', padding: 8 } },
  { selector: 'node[level = "milli"]', style: { shape: 'hexagon', 'border-width': 3, 'border-color': t.accent, 'font-size': 15, 'font-weight': 600, padding: 22 } },
  { selector: 'node[level = "micro"]', style: { 'border-width': 3, 'border-color': t.ink2, 'font-size': 13, 'font-weight': 600, padding: 12 } },
  { selector: 'node[status = "proposed"]', style: { 'border-style': 'dashed' } },
  { selector: 'node[kind = "clause"]', style: { shape: 'rectangle', 'background-color': t.ground } },
  { selector: 'node[kind = "measure"]', style: { shape: 'ellipse' } },
  { selector: 'node[kind = "consequence"]', style: { shape: 'cut-rectangle', 'border-color': t.gap } },
  { selector: 'node[level = "pico"]', style: { shape: 'tag', 'font-family': MONO, 'font-size': 10, 'border-color': t.accent, padding: 5 } },
  // Curves keep parallel connections apart in a small graph; in a large one, straight lines draw many times faster.
  { selector: 'edge', style: { width: 1.2, 'line-color': t.rule, 'target-arrow-color': t.rule, 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8,
                               'curve-style': dense ? 'straight' : 'bezier' } },
  { selector: 'edge[kind = "composes"]', style: { width: 3, 'line-color': t.ink2, 'target-arrow-color': t.ink2, ...edgeLabel(t) } },
  { selector: 'edge[kind = "operates"]', style: { width: 2, 'line-style': 'dashed', 'line-color': t.gap, 'target-arrow-color': t.gap, ...edgeLabel(t), color: t.gap } },
  { selector: 'edge[kind = "precedence"]', style: { width: 3, 'line-color': t.accent, 'target-arrow-color': t.accent, ...edgeLabel(t), color: t.accent } },
  { selector: 'edge[kind = "uses"]', style: { width: 1, 'line-style': 'dotted', 'line-color': t.accent, 'target-arrow-color': t.accent } },
  { selector: 'edge[kind = "claims"][relation = "supports"]', style: { 'line-color': t.claimed, 'target-arrow-color': t.claimed } },
  { selector: 'edge[kind = "claims"][strength = "sufficient"]', style: { width: 3 } },
  { selector: 'edge[kind = "claims"][relation = "hinders"]', style: { 'line-color': t.gap, 'target-arrow-color': t.gap } },
  { selector: 'edge[kind = "claims"][relation = "conflicts"]', style: { 'line-color': t.gap, 'target-arrow-shape': 'tee', 'source-arrow-shape': 'tee', 'source-arrow-color': t.gap, 'target-arrow-color': t.gap } },
  { selector: 'edge[kind = "breaches"]', style: { 'line-color': t.gap, 'target-arrow-color': t.gap, width: 1.5 } },
  { selector: 'edge[kind = "influences"]', style: { 'line-color': t.ink3, 'target-arrow-color': t.ink3, width: 1 } },
  { selector: 'edge[kind = "depends"]', style: { 'line-color': t.ink3, 'target-arrow-color': t.ink3, width: 1, ...(dense ? {} : { ...edgeLabel(t), 'font-size': 9 }) } },
  { selector: 'node[kind = "unit"]', style: { 'font-family': MONO, 'font-size': 10 } },
  { selector: 'edge[kind = "implements"]', style: { 'line-color': t.claimed, 'target-arrow-color': t.claimed, 'line-style': 'dashed', width: 1.2 } },
  { selector: 'edge[kind = "through"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [3, 4], width: 1, opacity: 0.75 } },
  { selector: 'node:selected', style: { 'border-color': t.accent, 'border-width': 4 } },
  { selector: '.faded', style: { opacity: 0.12 } },
];

// A large graph, or one level holding many nodes with few connections among them (a micro's seventy nanos), lays out
// badly as a flow: far too wide to read. Then each level becomes a band of rows, top to bottom. Within a level, what
// includes others comes first (a service above its files, a proposal above what it adds); then its nodes are grouped
// by kind, and units of software by form, each group starting a row of its own, rows as wide as the canvas allows.
const BANDS = ['milli', 'micro', 'nano', 'pico'];
const KIND_ORDER = ['intent', 'clause', 'parameter', 'measure', 'assumption', 'consequence',
                    'import', 'export', 'function', 'class', 'const', 'let', 'statement', 'table', 'view', 'trigger', 'insert',
                    'rule', 'media', 'section', 'document', 'tail'];
function inBands() {
  const W = 190, H = 72, GAP = 90;
  const aspect = Math.max(1, cy.width() / Math.max(1, cy.height()));
  const depth = new Map();   // the longest chain of inclusions above a node
  const composes = n => n.outgoers('edge[kind = "composes"]').targets();
  for (const queue = cy.nodes().filter(n => n.incomers('edge[kind = "composes"]').empty()).map(n => [n, 0]); queue.length;) {
    const [n, d] = queue.shift();
    if ((depth.get(n.id()) ?? -1) >= d) continue;
    depth.set(n.id(), d);
    composes(n).forEach(t => queue.push([t, d + 1]));
  }
  const group = n => (n.data('kind') === 'unit' ? n.data('form') : n.data('kind'));
  const rank = k => { const i = KIND_ORDER.indexOf(k); return i < 0 ? KIND_ORDER.length : i; };
  const positions = {};
  let y = 0;
  for (const level of BANDS) {
    const band = cy.nodes().filter(n => n.data('level') === level);
    if (!band.length) continue;
    const cols = Math.max(4, Math.ceil(Math.sqrt((band.length * aspect * H) / W)));
    const keys = [...new Set(band.map(n => `${depth.get(n.id()) ?? 0}|${group(n)}`))]
      .sort((a, b) => Number(a.split('|')[0]) - Number(b.split('|')[0]) || rank(a.split('|')[1]) - rank(b.split('|')[1]));
    for (const key of keys) {
      const row = band.filter(n => `${depth.get(n.id()) ?? 0}|${group(n)}` === key).sort((a, b) => a.data('label').localeCompare(b.data('label')));
      row.forEach((n, i) => {
        const inRow = Math.min(cols, row.length - Math.floor(i / cols) * cols);
        positions[n.id()] = { x: ((i % cols) - (inRow - 1) / 2) * W, y: y + Math.floor(i / cols) * H };
      });
      y += Math.ceil(row.length / cols) * H;
    }
    y += GAP;
  }
  cy.layout({ name: 'preset', positions: n => positions[n.id()], animate: false }).run();
}

// Incremental, as a compiler recomputes only what an edit touched: the graph for a scope is built once, and a change of
// levels or relations only filters it.
const built = new Map();
function graphFor() {
  const key = `${state.scope}|${state.revisions}`;
  if (!built.has(key)) built.set(key, buildGraph(cat, { scope: state.scope, revisions: state.revisions }));
  return filterGraph(built.get(key), { levels: [...state.levels], relations: [...state.relations] });
}

function draw() {
  const g = graphFor();
  // Decide the layout before laying anything out: a large graph goes straight into bands, never through the flowing
  // layout first (which costs seconds on hundreds of nodes, only to be thrown away).
  const large = g.nodes.length > 40;
  if (large !== dense) { dense = large; cy.style(style(palette(), dense)); }
  cy.batch(() => {   // one style and render pass for the whole swap, not one per element
    cy.elements().remove();
    cy.add([...g.nodes.map(n => ({ group: 'nodes', data: n })), ...g.edges.map((e, i) => ({ group: 'edges', data: { id: `e${i}`, ...e } }))]);
  });
  if (dense) inBands();
  else {
    cy.layout(LAYOUT).run();
    const box = cy.elements().boundingBox();
    if (box.w > box.h * 2.5 && cy.nodes().length > 16) inBands();
  }
  cy.fit(undefined, 30);
  $('#count').textContent = `${g.nodes.length} nodes · ${g.edges.length} connections`;
  writeUrl();
  intro(g);
}

// ─── The panel ───────────────────────────────────────────────────────────────

const PHRASE = {
  composes: e => e.data('label'), operates: e => e.data('label'), precedence: e => `prevails, by ${e.data('label')}, over`,
  holds: () => 'holds', refines: () => 'refines', uses: () => 'uses', breaches: () => 'if breached, costs',
  claims: e => `${e.data('relation')}${e.data('strength') && e.data('relation') !== 'conflicts' ? ` (${e.data('strength')})` : ''}`,
  influences: e => (e.data('direction') ?? 'bears on').replace(/-/g, ' '), through: () => 'reaches, through hidden levels,',
  depends: e => e.data('relation') ?? 'uses', implements: () => 'implements', evaluates: () => 'evaluates',
};
const LEVEL_WORD = { milli: 'milli', micro: 'micro', nano: 'nano', pico: 'pico' };

function intro(g) {
  $('#details').innerHTML = `
    <h2 class="detail-kind">How to read the levels</h2>
    <p class="detail-note">Millis sit at the top, then the micros they include, the nanos those hold, and the picos the nanos use. Choose which levels and relations to see. A hidden level is crossed, not cut: what it connected stays connected by a dashed line.</p>
    <p class="detail-note">Click a node to see everything it connects to.</p>
    ${g.nodes.length ? '' : '<p class="empty">Nothing at these levels in this scope.</p>'}`;
}

function select(node) {
  cy.elements().removeClass('faded');
  cy.elements().not(node.closedNeighborhood()).addClass('faded');
  const d = node.data();
  const rows = node.connectedEdges().map(e => {
    const out = e.source().id() === d.id, other = out ? e.target() : e.source();
    const verb = PHRASE[e.data('kind')]?.(e) ?? e.data('kind');
    return `<li>${out ? `<em>${esc(verb)}</em>` : `<em>${esc(verb)}</em> by`} <button type="button" class="node-link" data-node="${esc(other.id())}">${esc(other.data('label'))}</button>
      <span class="ref">${esc(LEVEL_WORD[other.data('level')])}</span></li>`;
  });
  const link = d.contract ? `<p class="detail-note"><a href="./?${new URLSearchParams({ contract: d.contract, ...(store !== 'catalogue' && { store }) })}">Open in the Contracts view</a> · <a href="?${new URLSearchParams({ ...(store !== 'catalogue' && { store }), scope: d.contract, levels: [...state.levels].join(',') })}">Scope the levels to it</a></p>` : '';
  $('#details').innerHTML = `
    <p class="detail-kind">${esc(LEVEL_WORD[d.level])}${d.kind && d.kind !== 'social' && d.kind !== 'micro' ? ` · ${esc(d.kind)}` : ''}${d.status ? ` · ${esc(d.status)}` : ''}</p>
    <p class="detail-text">${esc(d.title)}</p>
    <p class="ref">${esc(d.id)}</p>
    ${link}
    <h3 class="detail-h">Connections</h3>
    ${rows.length ? `<ul class="detail-list">${rows.join('')}</ul>` : '<p class="empty">None at the levels and relations shown.</p>'}`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const source = await findSource(store);
  try { cat = await source.catalogue(); }
  catch (err) { $('#details').innerHTML = `<p class="notice error">${esc(err.message)}</p>`; return; }

  const storeSelect = $('#store');
  storeSelect.innerHTML = Object.entries(STORES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  storeSelect.value = store;
  storeSelect.addEventListener('change', () => { location.search = storeSelect.value === 'catalogue' ? '' : `?store=${storeSelect.value}`; });

  const latest = latestById(Object.values(cat.contracts));
  const contracts = [...latest.values()].filter(c => c.status !== 'retired');
  if (state.scope !== 'all' && !latest.has(state.scope)) state.scope = 'all';
  const scope = $('#scope');
  scope.innerHTML = `<option value="all">The whole store</option>${contracts.map(c => `<option value="${esc(c.id)}">${esc(c.title)} (${c.scale === 'social' ? 'milli' : 'micro'})</option>`).join('')}`;
  scope.value = state.scope;
  scope.addEventListener('change', () => { state.scope = scope.value; draw(); });

  const boxes = (id, entries, chosen) => {
    $(`#${id}`).insertAdjacentHTML('beforeend', entries.map(([key, label, title]) =>
      `<label${title ? ` title="${esc(title)}"` : ''}><input type="checkbox" data-${id}="${key}"${chosen.has(key) ? ' checked' : ''}> ${esc(label)}</label>`).join(''));
    $(`#${id}`).addEventListener('change', e => {
      const key = e.target.dataset[id];
      if (!key) return;
      if (e.target.checked) chosen.add(key); else chosen.delete(key);
      draw();
    });
  };
  boxes('levels', Object.entries(LEVELS), state.levels);
  boxes('relations', Object.entries(RELATIONS).map(([key, [label, title]]) => [key, label, title]), state.relations);
  $('#apart').checked = state.revisions === 'apart';
  $('#apart').addEventListener('change', e => { state.revisions = e.target.checked ? 'apart' : 'merge'; draw(); });

  cy = cytoscape({ container: $('#graph'), style: style(palette()), wheelSensitivity: 0.3, minZoom: 0.05, maxZoom: 3 });
  cy.on('tap', 'node', e => select(e.target));
  cy.on('tap', e => { if (e.target === cy) { cy.elements().removeClass('faded'); intro({ nodes: cy.nodes() }); } });
  $('#details').addEventListener('click', e => {
    const b = e.target.closest('[data-node]');
    if (!b) return;
    const node = cy.getElementById(b.dataset.node);
    node.select();
    select(node);
    cy.animate({ center: { eles: node } }, { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
  });
  $('#fit').addEventListener('click', () => cy.fit(undefined, 30));
  window.addEventListener('resize', () => cy.resize());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cy.style(style(palette(), dense)));
  draw();
}

main();
