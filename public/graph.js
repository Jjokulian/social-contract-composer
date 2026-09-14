// The graph view: the same composition as the Contracts view, drawn as nodes and edges that flow upward into the top
// intents. Intents at the top, the clauses that serve them below, measures and consequences further down.
import { evaluate } from './evaluate.mjs';
import { findSource, storeOf, STORES } from './source.mjs';
import { coverageReason } from './explain.mjs';

const $ = selector => document.querySelector(selector);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, max) => (s = String(s ?? '')).length > max ? `${s.slice(0, max - 1)}…` : s;

try { cytoscape.use(window.cytoscapeDagre); } catch { /* already registered by its own script */ }
// The layered layout when its script loaded; Cytoscape's own breadth-first layout otherwise.
const LAYOUT = (() => { try { return cytoscape('layout', 'dagre'); } catch { return null; } })()
  ? { name: 'dagre', rankDir: 'BT', ranker: 'tight-tree', nodeSep: 18, rankSep: 90, edgeSep: 10, animate: false, fit: false }
  : { name: 'breadthfirst', directed: true, fit: false };

// Open at a readable size: fit when the whole graph is legible; otherwise zoom to reading size with the top intents
// near the top edge. "Fit to screen" always shows everything.
const READABLE = 0.62;
function frame() {
  cy.fit(undefined, 30);
  if (cy.zoom() >= READABLE) return;
  const roots = cy.nodes('[kind = "intent"]').filter(n => n.outgoers('edge[kind = "refines"]').empty());
  if (roots.empty()) return;   // nothing but words, as in a vocabulary: fitting is the best view
  cy.zoom(READABLE);
  cy.center(roots);
  cy.panBy({ x: 0, y: -(cy.height() / 2 - roots.renderedBoundingBox().h / 2 - 40) });
}

let cy, report, source;
const store = storeOf(location.search);   // the catalogue, or the platform's own store
const query = id => new URLSearchParams({ contract: id, ...(store !== 'catalogue' && { store }) });
const treeNodes = new Map();
const layers = () => ({
  claims: $('#layer-claims').checked, influences: $('#layer-influences').checked,
  consequences: $('#layer-consequences').checked, picos: $('#layer-picos').checked,
});

// ─── From the report to nodes and edges ──────────────────────────────────────

function elements(r, show) {
  const nodes = new Map(), edges = [];
  const node = (id, kind, label, data = {}) => { if (!nodes.has(id)) nodes.set(id, { group: 'nodes', data: { id, kind, label, ...data } }); };
  const edge = (source, target, kind, data = {}) => {
    if (nodes.has(source) && nodes.has(target)) edges.push({ group: 'edges', data: { id: `e${edges.length}`, source, target, kind, ...data } });
  };
  const nano = ref => r.nanos[ref] ?? r.claims[ref] ?? { ref };

  const walk = (n, parent, seen) => {
    const first = !nodes.has(n.ref);
    node(n.ref, 'intent', short(n.statement, 120), { coverage: n.coverage });
    if (parent) edge(n.ref, parent, 'refines');
    if (first) n.children.forEach(k => walk(k, n.ref));
  };
  r.tree.forEach(n => walk(n, null));

  if (show.claims) {
    for (const ref of r.clauses) { const c = nano(ref); node(ref, 'clause', short(c.text, 110), { binding: c.binding }); }
    for (const c of Object.values(r.claims)) {
      if (c.relation === 'conflicts') { edge(c.from, c.to, 'conflict', { claim: c.ref }); continue; }
      edge(c.from, c.to, 'claim', { relation: c.relation, strength: c.strength, inactive: !c.active, outside: !c.endorsed, claim: c.ref });
      for (const g of c.given) if (g !== c.from) edge(g, c.to, 'given', { claim: c.ref });
    }
  }
  if (show.influences) {
    for (const ref of r.influences) {
      const i = nano(ref);
      for (const end of [i.from, i.to]) if (!nodes.has(end)) node(end, 'measure', short(nano(end).label ?? nano(end).statement ?? end, 60));
      edge(i.from, i.to, 'influence', { direction: i.direction, influence: ref });
    }
  }
  if (show.consequences) {
    for (const b of r.breaches) for (const q of b.consequences) {
      node(q, 'consequence', short(nano(q).statement, 60));
      edge(q, b.clause, 'breach', { setBy: b.setBy });
    }
  }
  if (show.picos) {
    // The composition's own words, and every recorded reference to a pico, including the picos' references to one
    // another. Revisions of one word are drawn as one node: the Contracts view reports revisions that differ.
    const latest = new Map();
    for (const n of Object.values(r.nanos)) if (n.kind === 'definition' && (!latest.has(n.id) || latest.get(n.id).rev < n.rev)) latest.set(n.id, n);
    const word = ref => latest.get(String(ref).split('@')[0])?.ref ?? ref;
    for (const n of latest.values()) node(n.ref, 'pico', n.termLabel ?? n.ref);
    for (const queue = [...nodes.keys()]; queue.length;) {
      const id = queue.shift();
      for (const ref of new Set((nano(id).picos ?? []).map(p => word(p.pico)))) {
        if (ref === id) continue;
        if (!nodes.has(ref)) { node(ref, 'pico', nano(ref).termLabel ?? ref); queue.push(ref); }
        edge(ref, id, 'uses');
      }
    }
  }
  return [...nodes.values(), ...edges];
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function palette() {
  const s = getComputedStyle(document.documentElement), v = name => s.getPropertyValue(name).trim();
  return { ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), rule: v('--rule-strong'), surface: v('--surface'), ground: v('--ground'),
           accent: v('--accent'), claimed: v('--claimed'), thin: v('--thin'), gap: v('--gap') };
}

const SERIF = 'Source Serif 4, Georgia, serif', SANS = 'IBM Plex Sans, system-ui, sans-serif', MONO = 'IBM Plex Mono, monospace';
const style = t => [
  { selector: 'node', style: {
    label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 170, 'font-family': SERIF, 'font-size': 12, color: t.ink,
    'text-valign': 'center', 'text-halign': 'center', 'background-color': t.surface, 'border-width': 1.5, 'border-color': t.rule,
    shape: 'round-rectangle', width: 'label', height: 'label', padding: 10 } },
  { selector: 'node[kind = "intent"]', style: { 'border-width': 3, 'font-size': 13, 'font-weight': 600 } },
  { selector: 'node[coverage = "claimed"]', style: { 'border-color': t.claimed } },
  { selector: 'node[coverage = "thin"]', style: { 'border-color': t.thin, 'border-style': 'dashed' } },
  { selector: 'node[coverage = "gap"]', style: { 'border-color': t.gap, 'border-style': 'dotted' } },
  { selector: 'node[kind = "clause"]', style: { shape: 'rectangle', 'font-size': 11, 'text-max-width': 190, 'background-color': t.ground } },
  { selector: 'node[kind = "measure"]', style: { shape: 'ellipse', 'font-family': SANS, 'font-size': 11, color: t.ink2, padding: 14 } },
  { selector: 'node[kind = "consequence"]', style: { shape: 'cut-rectangle', 'font-family': SANS, 'font-size': 11, 'border-color': t.gap } },
  { selector: 'node[kind = "pico"]', style: { shape: 'tag', 'font-family': MONO, 'font-size': 10, color: t.accent, 'border-color': t.accent } },
  { selector: 'edge', style: {
    width: 1.5, 'curve-style': 'bezier', 'line-color': t.rule, 'target-arrow-shape': 'triangle', 'target-arrow-color': t.rule, 'arrow-scale': 0.8 } },
  { selector: 'edge[kind = "claim"][relation = "supports"]', style: { 'line-color': t.claimed, 'target-arrow-color': t.claimed } },
  { selector: 'edge[kind = "claim"][relation = "hinders"]', style: { 'line-color': t.gap, 'target-arrow-color': t.gap } },
  { selector: 'edge[strength = "contributes"]', style: { 'line-style': 'dashed' } },
  { selector: 'edge[strength = "sufficient"]', style: { width: 3.5 } },
  { selector: 'edge[kind = "given"]', style: { 'line-style': 'dotted', width: 1.2, 'line-color': t.ink2, 'target-arrow-shape': 'none' } },
  { selector: 'edge[kind = "influence"]', style: { 'line-color': t.ink3, 'target-arrow-color': t.ink3, width: 1 } },
  { selector: 'edge[direction = "stands-in-for"]', style: { 'line-style': 'dashed' } },
  { selector: 'edge[kind = "breach"]', style: { 'line-color': t.gap, 'target-arrow-shape': 'none', 'source-arrow-shape': 'tee', 'source-arrow-color': t.gap } },
  { selector: 'edge[kind = "conflict"]', style: { 'line-color': t.gap, 'line-style': 'dashed', 'target-arrow-shape': 'none', label: 'conflicts',
    'font-family': SANS, 'font-size': 10, color: t.gap } },
  { selector: 'edge[kind = "uses"]', style: { 'line-color': t.accent, 'target-arrow-color': t.accent, width: 1, 'line-style': 'dotted' } },
  { selector: 'edge[?inactive], edge[?outside]', style: { opacity: 0.4 } },
  { selector: '.faded', style: { opacity: 0.1 } },
  { selector: 'node.focus', style: { 'border-color': t.accent, 'border-width': 4 } },
];

function draw() {
  const els = elements(report, layers());
  if (!cy) {
    cy = cytoscape({ container: $('#graph'), elements: els, style: style(palette()), wheelSensitivity: 0.25, minZoom: 0.15, maxZoom: 2.5 });
    cy.on('tap', 'node', e => select(e.target));
    cy.on('tap', e => { if (e.target === cy) clear(); });
  } else {
    cy.elements().remove();
    cy.add(els);
  }
  cy.layout(LAYOUT).run();
  frame();
  clear();
}

// ─── Selection and details ───────────────────────────────────────────────────

function clear() {
  cy.elements().removeClass('faded focus');
  $('#details').innerHTML = `
    <section><h2>How to read the graph</h2>
      <p class="detail-note">Everything flows upward into the top intents. An intent’s border shows its coverage: solid for claimed, dashed for thin, dotted for a gap. Below the intents sit the clauses that serve them; a thick line is a sufficient claim, a dashed one a contributing claim, a red one hinders. Measures and influences sit further down.</p>
      <p class="detail-note">Click a node to see its neighbourhood and details. Scroll to zoom, drag to move. The same content is listed in the <a href="./?${query(report.contract.id)}">Contracts view</a>.</p>
    </section>`;
}

function select(n) {
  cy.elements().addClass('faded').removeClass('focus');
  n.closedNeighborhood().removeClass('faded');
  n.addClass('focus');
  const d = n.data(), nano = report.nanos[d.id] ?? {};
  const line = (kind, text, extra = '') => `<li><span class="detail-kind">${kind}</span> ${esc(text)}${extra}</li>`;
  const claimsTo = Object.values(report.claims).filter(c => c.to === d.id);
  const claimsFrom = Object.values(report.claims).filter(c => c.from === d.id);
  const claimLine = (c, other) => line(`${c.relation} · ${c.strength}`, short((report.nanos[other] ?? {}).text ?? (report.nanos[other] ?? {}).statement ?? other, 110),
    `${c.active ? '' : ' <em>(does not apply)</em>'}${c.endorsed ? '' : ' <em>(not endorsed)</em>'}`);
  let body = '';
  if (d.kind === 'intent') {
    const t = treeNodes.get(d.id);
    body = `<p class="detail-kind"><span class="cov ${t.coverage}">${t.coverage}</span></p>
      <p class="detail-text">${esc(nano.statement)}</p>
      <p class="detail-note">${esc(coverageReason(t, report.claims))}</p>
      ${t.children.length ? `<h3 class="detail-h">Needs ${t.combine} of</h3><ul class="detail-list">${t.children.map(k => line(k.coverage, k.statement)).join('')}</ul>` : ''}
      ${claimsTo.length ? `<h3 class="detail-h">Claims about it</h3><ul class="detail-list">${claimsTo.map(c => claimLine(c, c.from)).join('')}</ul>` : ''}`;
  } else if (d.kind === 'clause') {
    const breach = report.breaches.find(b => b.clause === d.id);
    body = `<p class="detail-kind">clause · ${esc(nano.roleLabel)} ${esc(nano.modality)} · ${esc(nano.binding)}</p>
      <p class="detail-text">${esc(nano.text)}</p>
      ${claimsFrom.length ? `<h3 class="detail-h">It is claimed to</h3><ul class="detail-list">${claimsFrom.map(c => claimLine(c, c.to)).join('')}</ul>` : ''}
      ${breach ? `<h3 class="detail-h">If breached</h3><ul class="detail-list">${breach.consequences.map(q => line('consequence', report.nanos[q]?.statement ?? q)).join('')}</ul>` : ''}`;
  } else if (d.kind === 'pico') {
    body = `<p class="detail-kind">pico · defined word</p><p class="detail-text">${esc(nano.termLabel)}</p>
      <p class="detail-note">${esc(nano.meaning)}</p><p class="detail-note">Referred to by: ${nano.forms.map(f => `“${esc(f)}”`).join(', ')}</p>`;
  } else {
    const infl = report.influences.map(ref => report.nanos[ref]).filter(i => i.from === d.id || i.to === d.id);
    body = `<p class="detail-kind">${esc(d.kind)}</p><p class="detail-text">${esc(nano.label ?? nano.statement ?? d.label)}</p>
      ${nano.description ? `<p class="detail-note">${esc(nano.description)}</p>` : ''}
      ${infl.length ? `<h3 class="detail-h">Influences</h3><ul class="detail-list">${infl.map(i => line(i.direction.replace(/-/g, ' '),
        `${(report.nanos[i.from] ?? {}).label ?? i.from} → ${(report.nanos[i.to] ?? {}).label ?? (report.nanos[i.to] ?? {}).statement ?? i.to}`, `<br><em>${esc(i.rationale)}</em>`)).join('')}</ul>` : ''}`;
  }
  $('#details').innerHTML = `<section>${body}<p class="detail-note"><span class="ref">${esc(d.id)}</span></p></section>`;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

async function load(id) {
  report = evaluate(await source.snapshot(id), {});
  treeNodes.clear();
  const walk = n => { treeNodes.set(n.ref, n); n.children.forEach(walk); };
  report.tree.forEach(walk);
  history.replaceState(null, '', `?${query(id)}`);
  document.querySelectorAll('a[data-keep-contract]').forEach(a => { a.href = `${a.dataset.keepContract}?${query(id)}`; });
  draw();
}

async function boot() {
  document.documentElement.style.setProperty('--bar-h', `${$('.bar').offsetHeight}px`);
  source = await findSource(store);
  const storeSelect = $('#store');
  storeSelect.innerHTML = Object.entries(STORES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('');
  storeSelect.value = store;
  storeSelect.addEventListener('change', () => { location.search = storeSelect.value === 'catalogue' ? '' : `?store=${storeSelect.value}`; });
  if (store === 'system') $('#layer-picos').checked = true;   // the platform's store is mostly words: show them
  const contracts = await source.contracts();
  const wanted = new URLSearchParams(location.search).get('contract');
  const id = contracts.some(c => c.id === wanted) ? wanted : (contracts.find(c => c.status !== 'proposed') ?? contracts[0]).id;
  const select = $('#contract');
  select.innerHTML = contracts.map(c => `<option value="${esc(c.id)}">${esc(c.title)} (${c.scale === 'social' ? 'milli' : 'micro'} · ${esc(c.status)})</option>`).join('');
  select.value = id;
  select.addEventListener('change', () => load(select.value));
  for (const box of document.querySelectorAll('.layers input')) box.addEventListener('change', draw);
  $('#fit').addEventListener('click', () => cy.fit(undefined, 30));
  window.addEventListener('resize', () => cy?.resize());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cy?.style(style(palette())));
  await load(id);
}

boot().catch(err => { $('#details').innerHTML = `<p class="notice error">${esc(err.message)}</p>`; });
