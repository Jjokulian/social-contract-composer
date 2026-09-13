// The composer client: reads a composition report from the server and renders it.
// State lives in the URL (?contract=…&society=…&p.<parameter>=…), so every view can be linked.
import { evaluate } from './evaluate.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const OPS = { '<': '<', '<=': '≤', '>': '>', '>=': '≥', '=': '=' };
const STATUS = {
  applies: 'applies',
  unverified: 'applies · assumptions unverified',
  inactive: 'does not apply at these values',
  contradicted: 'contradicted by evaluation',
};
const KIND = {
  'conditional': 'Conditional',
  'crux-on-assumption': 'Crux on an assumption',
  'direct': 'Direct disagreement',
  'divergent-context': 'Divergent context',
};

// ─── Server ──────────────────────────────────────────────────────────────────

async function getJSON(path) {
  const res = await fetch(path);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${path}`);
  return body;
}

// With a server, read from the API; on a static host (no /api), read the snapshots baked at build time.
// Either way the report is evaluated here, by the same module the server uses.
const SOURCES = {
  server: {
    contracts: () => getJSON('api/contracts'),
    societies: () => getJSON('api/societies'),
    snapshot: id => getJSON(`api/contracts/${encodeURIComponent(id)}/snapshot`),
  },
  static: {
    contracts: () => getJSON('data/contracts.json'),
    societies: () => getJSON('data/societies.json'),
    snapshot: id => getJSON(`data/snapshots/${encodeURIComponent(id)}.json`),
  },
};
let source;
const snapshots = new Map();

// ─── State ───────────────────────────────────────────────────────────────────

const state = { contract: null, society: '', parameters: {} };

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.contract = q.get('contract');
  state.society = q.get('society') ?? '';
  state.parameters = Object.fromEntries([...q].filter(([k]) => k.startsWith('p.')).map(([k, v]) => [k.slice(2), v]));
}

function writeUrl() {
  const q = new URLSearchParams({ contract: state.contract });
  if (state.society) q.set('society', state.society);
  for (const [id, value] of Object.entries(state.parameters)) q.set(`p.${id}`, value);
  history.replaceState(null, '', `?${q}`);
}

let sequence = 0;
async function load() {
  const mine = ++sequence;
  $('#doc').classList.add('busy');
  try {
    if (!snapshots.has(state.contract)) snapshots.set(state.contract, await source.snapshot(state.contract));
    if (mine !== sequence) return;
    const report = evaluate(snapshots.get(state.contract), state);
    writeUrl();
    render(report);
  } catch (err) {
    if (mine === sequence) fail(err.message);
  } finally {
    if (mine === sequence) $('#doc').classList.remove('busy');
  }
}

let timer;
const loadSoon = () => { clearTimeout(timer); timer = setTimeout(load, 16); };

function fail(message) {
  $('#doc').innerHTML = `<p class="notice error">${esc(message)}</p>`;
}

// ─── Rendering helpers ───────────────────────────────────────────────────────

const humanize = ref => {
  const id = String(ref).split('@')[0].replace(/\.[a-z0-9-]+$/, '').replace(/-/g, ' ');
  return id.charAt(0).toUpperCase() + id.slice(1);
};

function formatValue(p, value) {
  return p.unit === 'percent' ? `${value}%` : String(value);
}

const DIRECTION = { 'raises': 'raises', 'lowers': 'lowers', 'bears-on': 'bears on', 'stands-in-for': 'stands in for' };

function renderReport(r) {
  const nano = ref => r.nanos[ref] ?? r.claims[ref] ?? { ref };
  const named = ref => `<span title="${esc(nano(ref).text ?? nano(ref).statement ?? ref)}">${esc(humanize(ref))}</span>`;
  const intentText = ref => esc(nano(ref).statement ?? humanize(ref));
  const label = ref => esc(nano(ref).label ?? nano(ref).statement ?? humanize(ref));

  const flat = [];
  const walk = n => { if (!flat.some(f => f.ref === n.ref)) flat.push(n); n.children.forEach(walk); };
  r.tree.forEach(walk);
  const count = level => flat.filter(n => n.coverage === level).length;

  const clause = ref => {
    const c = nano(ref);
    if (!c.text) return esc(humanize(ref));
    return `<span class="modality" title="Binds: ${esc(c.roleLabel)}">${esc(c.modality)}</span> ${esc(c.text)}`;
  };

  const context = c => {
    const rows = [];
    if (c.given.length) rows.push(['given', c.given.map(named).join(', ')]);
    for (const w of c.when) {
      const p = nano(w.parameter);
      const mark = w.holds ? '<span class="holds">holds</span>' : '<span class="fails">does not hold</span>';
      rows.push(['when', `${esc(p.label ?? humanize(w.parameter))} ${OPS[w.op]} ${esc(formatValue(p, w.value))} · ${mark}${w.current !== null ? ` (now ${esc(formatValue(p, w.current))})` : ''}`]);
    }
    for (const a of c.assuming) {
      const seen = a.observed ? ` (observed ${esc(a.observed.value)}, ${esc(a.observed.observedOn)})` : '';
      const mark = a.status === 'supported' ? '<span class="holds">supported</span>'
        : a.status === 'contradicted' ? '<span class="fails">contradicted</span>' : 'unverified';
      rows.push(['assuming', `${esc(a.statement)} · ${mark}${seen}`]);
    }
    if (c.measuredBy.length) rows.push(['measured by', c.measuredBy.map(m => esc(nano(m).label ?? humanize(m))).join(', ')]);
    return rows.length ? `<dl class="ctx">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '';
  };

  const claimHtml = c => `
    <div class="claim${c.endorsed ? '' : ' outside'}">
      <div class="claim-head">
        <span class="relation ${c.relation}">${c.relation}</span>
        <span>${esc(c.strength)}</span>
        <span class="status ${c.status}">${STATUS[c.status]}</span>
        ${c.endorsed ? '' : '<span class="flag">not endorsed by the contract</span>'}
        <span class="ref">${esc(c.ref)} · filed by ${esc(c.filedBy)}</span>
      </div>
      <p class="clause-text" style="margin:0">${clause(c.from)}</p>
      <p class="rationale" style="margin:0">${esc(c.rationale)}</p>
      ${context(c)}
    </div>`;

  const order = c => (c.endorsed ? 0 : 2) + (c.active ? 0 : 1);
  const nodeHtml = node => {
    const all = Object.values(r.claims).filter(c => c.to === node.ref).sort((a, b) => order(a) - order(b));
    const tally = [
      [all.filter(c => c.active && c.relation === 'supports').length, 'supporting'],
      [all.filter(c => c.active && c.relation === 'hinders').length, 'hindering'],
      [all.filter(c => !c.active).length, 'not applying'],
    ].filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(' · ');
    const flags = [
      node.children.length ? `<span class="combine">needs ${node.combine} of the intents below</span>` : '',
      node.inTension ? '<span class="flag">⇄ in tension</span>' : '',
      node.challenges.length ? `<span class="flag">! challenged <b>${node.challenges.length}</b></span>` : '',
      node.disputed ? '<span class="flag">≠ disputed</span>' : '',
      `<span class="ref">${esc(node.ref)}</span>`,
    ].join('');
    return `
      <li class="intent">
        <div class="node">
          <span class="cov ${node.coverage}">${node.coverage}</span>
          <span class="statement">${esc(node.statement)}</span>
          <div class="node-meta">${flags}</div>
          ${node.influences.length ? `<p class="bears">Bears on it: ${node.influences.map(i => label(nano(i).from)).join(', ')}</p>` : ''}
          ${all.length ? `<details class="claims"><summary>${tally || 'claims'}</summary><div class="claim-list">${all.map(claimHtml).join('')}</div></details>` : ''}
        </div>
        ${node.children.length ? `<ul>${node.children.map(nodeHtml).join('')}</ul>` : ''}
      </li>`;
  };

  const section = (id, title, lede, body) =>
    `<section class="section" id="${id}"><h2>${title}</h2>${lede ? `<p class="lede">${lede}</p>` : ''}${body}</section>`;
  const empty = text => `<p class="empty">${text}</p>`;

  const diffItems = (d, side) => [
    ...d.given[side].map(named),
    ...d.when[side].map(k => { const [ref, op, v] = k.split(' '); return `${esc(nano(ref).label ?? humanize(ref))} ${OPS[op] ?? op} ${esc(v)}`; }),
    ...d.assuming[side].map(ref => esc(nano(ref).statement ?? humanize(ref))),
  ].join('<br>') || '—';

  const disagreementHtml = d => {
    const a = r.claims[d.a], b = r.claims[d.b];
    const side = (label, c) => `
      <div class="side">
        <span class="side-label">${label} · ${esc(c.filedBy)}</span>
        <span><span class="relation ${c.relation}">${c.relation}</span> · ${esc(c.strength)} · <span class="status ${c.status}">${STATUS[c.status]}</span></span>
        <p class="rationale" style="margin:0">${esc(c.rationale)}</p>
      </div>`;
    return `
      <div class="finding">
        <h3>${named(d.from)} → ${intentText(d.to)}</h3>
        <div><span class="kind-chip">${KIND[d.kind]}</span></div>
        <div class="pair">${side('A', a)}${side('B', b)}</div>
        <div style="overflow-x:auto"><table class="diff">
          <tr><th>Shared context</th><td>${diffItems(d, 'shared')}</td></tr>
          <tr><th>Only in A</th><td>${diffItems(d, 'onlyA')}</td></tr>
          <tr><th>Only in B</th><td>${diffItems(d, 'onlyB')}</td></tr>
        </table></div>
        <p class="settled" style="margin:0"><strong>Settled by:</strong> ${esc(d.settledBy)}</p>
      </div>`;
  };

  const outside = Object.values(r.claims).filter(c => !c.endorsed);
  const definitions = Object.values(r.nanos).filter(n => n.kind === 'definition');
  const { checks } = r;

  const bar = ['claimed', 'thin', 'gap'].map(level => count(level)
    ? `<span class="swatch-${level}" style="flex:${count(level)}" title="${count(level)} ${level}"></span>` : '').join('');

  return [
    `<header>
      <p class="eyebrow">${esc(r.contract.scale)}-social-contract · ${esc(r.contract.status)} · ${esc(r.contract.ref)}${r.society ? ` · evaluated in ${esc(r.society)}` : ''}</p>
      <h1 class="title">${esc(r.contract.title)}</h1>
      <p class="thesis">${r.tree.map(n => esc(n.statement)).join(' · ')}</p>
      <div class="coverage-bar" role="img" aria-label="${count('claimed')} intents claimed, ${count('thin')} thin, ${count('gap')} gaps">${bar}</div>
      <div class="legend">
        <span class="cov claimed">${count('claimed')} claimed: a sufficient claim, or covered children</span>
        <span class="cov thin">${count('thin')} thin: only contributing claims</span>
        <span class="cov gap">${count('gap')} gap: nothing claims it</span>
      </div>
    </header>`,
    section('intents', 'Intents', 'What the contract claims to satisfy. Open an intent to see the claims behind it, what each depends on, and whether it applies at the current parameter values.',
      `<ul class="tree">${r.tree.map(nodeHtml).join('')}</ul>`),
    section('disagreements', 'Disagreements', 'Claims about the same clause and intent that reach different conclusions, with the context that separates them.',
      checks.disagreements.length ? checks.disagreements.map(disagreementHtml).join('')
        : empty('None yet. When anyone files a counter-claim, it appears here with the difference in context that explains it.')),
    section('tensions', 'Tensions and challenges', 'Where the contract’s own claims pull against one of its intents, and claims filed for evaluation that the contract doesn’t endorse.',
      (checks.tensions.map(t => `
        <div class="finding">
          <h3>${named(t.clause)}</h3>
          <p style="margin:0">Supports ${t.supports.map(intentText).join(', ') || 'nothing'}; hinders ${t.hinders.map(intentText).join(', ')}.</p>
        </div>`).join('') + outside.map(claimHtml).join('')) || empty('No tensions, and no outside claims in scope.')),
    section('determinants', 'What bears on what', 'Influences recorded without asserting that they are true. Each group that adopts the contract decides which of them it believes.',
      [...new Set(r.influences.map(i => nano(i).to))].map(target => `
        <div class="finding">
          <h3>${label(target)}</h3>
          <dl class="ctx">${r.influences.filter(i => nano(i).to === target).map(i => {
            const x = nano(i);
            return `<dt>${label(x.from)}</dt><dd><strong>${DIRECTION[x.direction]}</strong> it. ${esc(x.rationale)} <span class="ref">filed by ${esc(x.filedBy)}</span></dd>`;
          }).join('')}</dl>
        </div>`).join('') || empty('No influences recorded for this composition.')),
    section('structure', 'Structure', null, `
      <div class="finding"><h3>Orphan clauses</h3>${checks.orphans.length
        ? `<p style="margin:0">${checks.orphans.map(named).join(', ')}: no standing claim connects these to an intent at the current values.</p>`
        : empty('Every clause serves an intent, directly or as a precondition.')}</div>
      <div class="finding"><h3>Conflicts</h3>${checks.conflicts.length
        ? checks.conflicts.map(c => `<p style="margin:0">${named(c.between[0])} conflicts with ${named(c.between[1])} <span class="ref">${esc(c.claim)}</span></p>`).join('')
        : empty('No conflicting nanos in this composition.')}</div>
      <div class="finding"><h3>Definition clashes</h3>${checks.definitionClashes.length
        ? checks.definitionClashes.map(d => `<p style="margin:0">“${esc(d.term)}” is defined twice: ${d.definitions.map(named).join(' and ')}</p>`).join('')
        : empty('Each term has one definition.')}</div>`),
    section('definitions', 'Definitions', 'The contract’s own terms. They hold within this contract; where a composition brings in a different definition, it shows as a clash above.',
      `<dl class="defs">${definitions.map(d => `<div><dt>${esc(d.termLabel)} <span class="ref">${esc(d.ref)}</span></dt><dd>${esc(d.meaning)}</dd></div>`).join('')}</dl>`),
  ].join('');
}

// ─── Panel: parameters are built once per contract so a slider keeps focus while dragging ─

function renderPanel(r) {
  const panel = $('#panel');
  if (panel.dataset.contract !== r.contract.ref) {
    panel.dataset.contract = r.contract.ref;
    panel.innerHTML = `
      <section>
        <h2>Parameters</h2>
        ${r.parameters.length ? '' : '<p class="empty">This contract sets no parameters.</p>'}
        ${r.parameters.map(p => {
          const step = p.max - p.min <= 2 ? 0.05 : 1;
          return `
          <div class="param" data-id="${esc(p.id)}">
            <label class="param-head" for="param-${esc(p.id)}"><span>${esc(p.label)}</span><span class="param-value"></span></label>
            <input type="range" id="param-${esc(p.id)}" min="${p.min}" max="${p.max}" step="${step}">
            <div class="param-foot"><span>${esc(formatValue(p, p.min))}–${esc(formatValue(p, p.max))} ${esc(p.unitLabel)} · contract sets ${esc(formatValue(p, p.contractValue))}</span><button type="button">Reset</button></div>
          </div>`;
        }).join('')}
      </section>
      <section><h2>Findings</h2><ul class="tally" id="tally"></ul></section>`;
    for (const p of r.parameters) {
      const row = panel.querySelector(`.param[data-id="${CSS.escape(p.id)}"]`);
      const input = row.querySelector('input');
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (value === p.contractValue) delete state.parameters[p.id]; else state.parameters[p.id] = value;
        row.querySelector('.param-value').textContent = formatValue(p, value);
        row.classList.toggle('changed', value !== p.contractValue);
        loadSoon();
      });
      row.querySelector('button').addEventListener('click', () => { delete state.parameters[p.id]; load(); });
    }
  }
  for (const p of r.parameters) {
    const row = panel.querySelector(`.param[data-id="${CSS.escape(p.id)}"]`);
    const input = row.querySelector('input');
    if (document.activeElement !== input) input.value = p.value;
    row.querySelector('.param-value').textContent = formatValue(p, p.value);
    row.classList.toggle('changed', p.overridden);
    row.querySelector('button').hidden = !p.overridden;
  }

  const c = r.checks;
  const challenged = Object.values(r.claims).filter(x => !x.endorsed && x.active).length;
  const rows = [
    ['intents', 'Intents with a gap', c.gaps.length],
    ['intents', 'Intents thinly covered', c.thin.length],
    ['tensions', 'Tensions', c.tensions.length],
    ['tensions', 'Outside claims that apply', challenged],
    ['disagreements', 'Disagreements', c.disagreements.length],
    ['determinants', 'Influences recorded', r.influences.length],
    ['structure', 'Orphan clauses', c.orphans.length],
    ['structure', 'Conflicts', c.conflicts.length],
    ['structure', 'Definition clashes', c.definitionClashes.length],
  ];
  $('#tally').innerHTML = rows.map(([id, label, n]) =>
    `<li><a href="#${id}"><span>${label}</span><span class="n${n ? '' : ' zero'}">${n}</span></a></li>`).join('');
}

function render(r) {
  $('#doc').innerHTML = renderReport(r);
  renderPanel(r);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  readUrl();
  source = await getJSON('api/config').then(() => SOURCES.server, () => SOURCES.static);   // a 404 is an answer, not an error

  const [contracts, societies] = await Promise.all([source.contracts(), source.societies()]).catch(err => { fail(err.message); return []; });
  if (!contracts) return;
  if (!contracts.length) return fail('The store has no contracts yet.');
  if (!contracts.some(c => c.id === state.contract)) state.contract = contracts[0].id;

  const contractSelect = $('#contract');
  contractSelect.innerHTML = contracts.map(c =>
    `<option value="${esc(c.id)}">${esc(c.title)} (${esc(c.scale)}, ${esc(c.status)})</option>`).join('');
  contractSelect.value = state.contract;
  contractSelect.addEventListener('change', () => { state.contract = contractSelect.value; state.parameters = {}; load(); });

  const societySelect = $('#society');
  societySelect.insertAdjacentHTML('beforeend', societies.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join(''));
  societySelect.disabled = !societies.length;
  societySelect.value = state.society;
  societySelect.addEventListener('change', () => { state.society = societySelect.value; load(); });

  load();
}

boot();
