// The composer client: reads a composition report from the server and renders it.
// State lives in the URL (?contract=…&society=…&p.<parameter>=…), so every view can be linked.
import { evaluate } from './evaluate.mjs';
import { picoMatcher } from './picos.mjs';
import { findSource } from './source.mjs';
import { coverageReason } from './explain.mjs';

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

// Contracts come from the server or the baked snapshots (public/source.mjs); either way the report is evaluated here,
// by the same module the server uses.
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
  document.querySelectorAll('a[data-keep-contract]').forEach(a => { a.href = `${a.dataset.keepContract}?contract=${encodeURIComponent(state.contract)}`; });
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

// Proposals and nanos raised in a GitHub issue carry `source: issue:<n>`; link them back to the discussion.
const REPO = 'https://github.com/Jjokulian/social-contract-composer';
const issueLink = source => {
  const m = /^issue:(\d+)$/.exec(source ?? '');
  return m ? `<a href="${REPO}/issues/${m[1]}">issue #${m[1]}</a>` : '';
};

// What a clause binds its role to. Detecting breaches of a rule is work too, carried by whoever the composition assigns.
const BINDING = {
  work: ['work', 'Work to carry out: someone has to do this.'],
  abide: ['abide', 'A rule to abide by: breaches have to be detected and met with consequences.'],
  liberty: ['liberty', 'A liberty: permitted, and no one is bound to act.'],
};
const bindingChip = b => BINDING[b] ? `<span class="binding ${b}" title="${BINDING[b][1]}">${BINDING[b][0]}</span>` : '';

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
    return `<span class="modality" title="Binds: ${esc(c.roleLabel)}">${esc(c.modality)}</span> ${bindingChip(c.binding)} ${terms(c.text, c)}`;
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

  const claimHtml = (c, withClause = true) => `
    <div class="claim${c.endorsed ? '' : ' outside'}">
      <div class="claim-head">
        <span class="relation ${c.relation}">${c.relation}</span>
        <span>${esc(c.strength)}</span>
        <span class="status ${c.status}">${STATUS[c.status]}</span>
        ${c.endorsed ? '' : '<span class="flag">not endorsed by the contract</span>'}
        <span class="ref">${esc(c.ref)} · filed by ${esc(c.filedBy)}${issueLink(c.source) ? ` · from ${issueLink(c.source)}` : ''}</span>
      </div>
      ${withClause ? `<p class="clause-text" style="margin:0">${clause(c.from)}</p>` : ''}
      <p class="rationale" style="margin:0">${terms(c.rationale, c)}</p>
      ${context(c)}
    </div>`;

  // Under an intent, each clause appears once, with every claim about it beneath: sufficient first.
  const byClause = claims => [...new Set(claims.map(c => c.from))].map(from => `
    <div class="claim-group">
      <p class="clause-text group-clause">${clause(from)}</p>
      ${claims.filter(c => c.from === from)
        .sort((a, b) => (b.strength === 'sufficient') - (a.strength === 'sufficient'))
        .map(c => claimHtml(c, false)).join('')}
    </div>`).join('');

  const order = c => (c.endorsed ? 0 : 2) + (c.active ? 0 : 1);
  const nodeHtml = (node, path = []) => {
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
      <li class="intent" data-key="${esc([...path, node.ref].join('>'))}">
        <div class="node">
          <span class="cov ${node.coverage}">${node.coverage}</span>
          <span class="statement">${terms(node.statement, nano(node.ref))}</span>
          <div class="node-meta">${flags}</div>
          ${node.influences.length ? `<p class="bears">Bears on it: ${node.influences.map(i => label(nano(i).from)).join(', ')}</p>` : ''}
          ${all.length ? `<details class="claims"><summary>${tally || 'claims'}</summary><div class="claim-list">${byClause(all)}</div></details>` : ''}
        </div>
        ${node.children.length ? `<ul>${node.children.map(k => nodeHtml(k, [...path, node.ref])).join('')}</ul>` : ''}
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

  // A milli is virtual until implemented on a territory: a coordinate segment in a named frame.
  const territoryLine = r => {
    const t = r.contract.territory && nano(r.contract.territory);
    if (!t) return '';
    const shape = t.geometry.type === 'Point' ? `a point at ${t.geometry.coordinates.join(', ')}` : `a ${t.geometry.type.toLowerCase()}`;
    return ` · on <span class="territory" title="${esc(`${t.ref}: ${shape} in ${t.frame}`)}">${esc(t.name)}</span>`;
  };

  const outside = Object.values(r.claims).filter(c => !c.endorsed);
  const definitions = Object.values(r.nanos).filter(n => n.kind === 'definition');
  const { checks } = r;

  const bar = ['claimed', 'thin', 'gap'].map(level => count(level)
    ? `<span class="swatch-${level}" style="flex:${count(level)}" title="${count(level)} ${level}"></span>` : '').join('');

  return [
    `<header>
      <p class="eyebrow">${r.contract.scale === 'social' ? 'milli: a composed social contract' : 'micro: a micro-social-contract'} · ${esc(r.contract.status)} · ${esc(r.contract.ref)}${territoryLine(r)}${r.society ? ` · evaluated in ${esc(r.society)}` : ''}</p>
      <h1 class="title">${esc(r.contract.title)}</h1>
      <p class="thesis">${r.tree.map(n => terms(n.statement, nano(n.ref))).join(' · ')}</p>
      ${r.contract.status === 'proposed' ? `<p class="proposal-note">A proposal, raised in ${issueLink(r.contract.source) || 'an issue'} and not yet granted. It composes ${r.contract.includes.map(i => `<code>${esc(i.ref)}</code>`).join(', ')} with the proposal’s own nanos, so its effect on the intents can be tested here before anyone decides. Discuss it on the issue.</p>` : ''}
      <div class="coverage-bar" role="img" aria-label="${count('claimed')} intents claimed, ${count('thin')} thin, ${count('gap')} gaps">${bar}</div>
      <div class="legend">
        <span class="cov claimed">${count('claimed')} claimed: a sufficient claim, or covered children</span>
        <span class="cov thin">${count('thin')} thin: only contributing claims</span>
        <span class="cov gap">${count('gap')} gap: nothing claims it</span>
      </div>
    </header>`,
    section('intents', 'Intents', 'What the contract claims to satisfy. Open an intent to see the claims behind it, what each depends on, and whether it applies at the current parameter values.',
      `<div class="trail" id="trail" aria-label="Where you are in the intents"></div>
       <div class="intents-flow">
         <nav class="funnel" id="funnel" aria-label="Where you are in the intents"></nav>
         <ul class="tree">${r.tree.map(n => nodeHtml(n)).join('')}</ul>
       </div>`),
    section('asks', 'What it asks of whom', 'Before you say “I do”: the work it binds people to carry out, the rules it binds them to abide by, and the liberties it grants. A rule is only as real as the detection of its breaches, and that detection is work that someone among the signatories has to take on.',
      [['work', 'Work to carry out'], ['abide', 'Rules to abide by'], ['liberty', 'Liberties']].map(([kind, heading]) => {
        const clauses = r.clauses.map(nano).filter(c => c.binding === kind);
        if (!clauses.length) return '';
        const roles = [...new Set(clauses.map(c => c.roleLabel))];
        return `<div class="finding"><h3>${heading}</h3><dl class="ctx">${roles.map(role => `<dt>${esc(role)}</dt><dd>${clauses.filter(c => c.roleLabel === role)
          .map(c => `${terms(c.text, c)}${kind === 'abide' ? (r.enforcement.some(e => e.clause === c.ref) ? '' : ' <span class="fails">· no one assigned to detect breaches</span>') : ''}`).join('<br>')}</dd>`).join('')}</dl></div>`;
      }).join('') || empty('This composition has no clauses yet.')),
    section('disagreements', 'Disagreements', 'Claims about the same clause and intent that reach different conclusions, with the context that separates them.',
      checks.disagreements.length ? checks.disagreements.map(disagreementHtml).join('')
        : empty('None yet. When anyone files a counter-claim, it appears here with the difference in context that explains it.')),
    section('tensions', 'Tensions and challenges', 'Where the contract’s own claims pull against one of its intents, and claims filed for evaluation that the contract doesn’t endorse.',
      (checks.tensions.map(t => `
        <div class="finding">
          <h3>${named(t.clause)}</h3>
          <p style="margin:0">Supports ${t.supports.map(intentText).join(', ') || 'nothing'}; hinders ${t.hinders.map(intentText).join(', ')}.</p>
        </div>`).join('') + outside.map(c => claimHtml(c)).join('')) || empty('No tensions, and no outside claims in scope.')),
    section('determinants', 'What bears on what', 'Influences recorded without asserting that they are true. Each group that adopts the contract decides which of them it believes.',
      [...new Set(r.influences.map(i => nano(i).to))].map(target => `
        <div class="finding">
          <h3>${label(target)}</h3>
          <dl class="ctx">${r.influences.filter(i => nano(i).to === target).map(i => {
            const x = nano(i);
            return `<dt>${label(x.from)}</dt><dd><strong>${DIRECTION[x.direction]}</strong> it. ${esc(x.rationale)} <span class="ref">filed by ${esc(x.filedBy)}</span></dd>`;
          }).join('')}</dl>
        </div>`).join('') || empty('No influences recorded for this composition.')),
    section('breaches', 'If a clause is breached', 'Consequences are set by the composing parties, who can also reverse them by agreement: re-admit a person, or hand back what was forfeited.',
      r.breaches.map(b => `
        <div class="finding">
          <h3>${named(b.clause)}</h3>
          <p class="clause-text" style="margin:0">${clause(b.clause)}</p>
          <dl class="ctx">
            <dt>consequences</dt><dd>${b.consequences.map(label).join('; ')}</dd>
            <dt>set by</dt><dd><code>${esc(b.setBy)}</code> · reversible by the parties</dd>
            <dt>detected by</dt><dd>${(r.enforcement.find(e => e.clause === b.clause)?.by ?? []).map(id => esc(r.roles[id] ?? id)).join(', ')
              || '<span class="fails">no one assigned to detect breaches</span>'}</dd>
          </dl>
        </div>`).join('') || empty('This composition attaches no consequences of breach yet. The composing parties decide which breach costs what.')),
    section('structure', 'Structure', null, `
      <div class="finding"><h3>Orphan clauses</h3>${checks.orphans.length
        ? `<p style="margin:0">${checks.orphans.map(named).join(', ')}: no standing claim connects these to an intent at the current values.</p>`
        : empty('Every clause serves an intent, directly or as a precondition.')}</div>
      <div class="finding"><h3>Conflicts</h3>${checks.conflicts.length
        ? checks.conflicts.map(c => `<p style="margin:0">${named(c.between[0])} conflicts with ${named(c.between[1])} <span class="ref">${esc(c.claim)}</span></p>`).join('')
        : empty('No conflicting nanos in this composition.')}</div>
      <div class="finding"><h3>Definition clashes</h3>${checks.definitionClashes.length
        ? checks.definitionClashes.map(d => `<p style="margin:0">${d.kind === 'versions'
            ? `Two revisions of “${esc(d.term)}” are in use: <span class="ref">${d.definitions.map(esc).join(' and ')}</span>`
            : `“${esc(d.term)}” has two senses in play: ${d.definitions.map(named).join(' and ')}`}</p>`).join('')
        : empty('Each term has one definition.')}</div>
      <div class="finding"><h3>Different revisions in use</h3>${checks.staleReferences.length
        ? `<p style="margin:0 0 6px">These nanos were written with a different revision of a pico than the one this contract defines. They keep the meaning they were written with until they are rewritten as new revisions.</p>`
          + checks.staleReferences.map(s => `<p style="margin:0">${named(s.nano)}: “${esc(s.phrase)}” means <span class="ref">${esc(s.pico)}</span>; this contract defines <span class="ref">${esc(s.current)}</span></p>`).join('')
        : empty('Every nano uses the revision of its picos that this contract defines.')}</div>`),
    section('definitions', 'Picos: defined words', 'Words with a strict definition in this contract. Wherever one appears in the text above, it is underlined; hover or focus it to read the definition. Where a composition brings in a different definition of the same word, it shows as a clash above.',
      `<dl class="defs">${definitions.map(d => `<div><dt>${esc(d.termLabel)} <span class="ref">${esc(d.ref)}</span></dt><dd>${terms(d.meaning, d)}</dd>
        <dd class="forms">refers to it: ${d.forms.map(f => `“${esc(f)}”`).join(', ')}</dd></div>`).join('')}</dl>`),
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
    ['breaches', 'Clauses with consequences', r.breaches.length],
    ['breaches', 'Consequences no one detects', c.unenforced.length],
    ['structure', 'Orphan clauses', c.orphans.length],
    ['structure', 'Conflicts', c.conflicts.length],
    ['structure', 'Definition clashes', c.definitionClashes.length],
    ['structure', 'Different revisions in use', c.staleReferences.length],
  ];
  $('#tally').innerHTML = rows.map(([id, label, n]) =>
    `<li><a href="#${id}"><span>${label}</span><span class="n${n ? '' : ' zero'}">${n}</span></a></li>`).join('');
}

// ─── Picos: strictly defined words, underlined wherever they appear, defined on hover or focus ─
// A word refers to a pico when it matches one of the pico's forms. Longest forms match first, whole words only.

// Plain text in, HTML out: the phrases `owner` recorded as referring to picos become underlined, focusable words.
// Only the nano's own recorded references are used, so a pico added later never changes what an existing nano says.
function terms(text, owner) {
  const recorded = owner?.picos ?? [];
  if (!recorded.length) return esc(text ?? '');
  return picoMatcher(recorded.map(r => ({ ref: r.pico, forms: [r.phrase] })))
    .render(String(text ?? ''), esc, (html, p) => `<span class="term" tabindex="0" data-pico="${esc(p.ref)}">${html}</span>`);
}

const tip = Object.assign(document.createElement('div'), { id: 'pico-tip', role: 'tooltip', hidden: true });
document.body.append(tip);
function showTip(el) {
  const p = shown?.nanos[el.dataset.pico];
  if (!p) return;
  tip.innerHTML = `<p class="tip-term">${esc(p.termLabel)} <span class="ref">pico · ${esc(p.ref)}</span></p><p class="tip-meaning">${esc(p.meaning)}</p>`;
  const box = el.getBoundingClientRect(), width = Math.min(380, innerWidth - 32);
  tip.style.width = `${width}px`;
  tip.hidden = false;
  tip.style.left = `${Math.max(16, Math.min(box.left, innerWidth - width - 16))}px`;
  tip.style.top = `${box.bottom + 8 + tip.offsetHeight > innerHeight ? box.top - tip.offsetHeight - 8 : box.bottom + 8}px`;
  el.setAttribute('aria-describedby', 'pico-tip');
}
const hideTip = () => { tip.hidden = true; };
document.addEventListener('mouseover', e => { const t = e.target.closest?.('.term'); if (t) showTip(t); });
document.addEventListener('mouseout', e => { if (e.target.closest?.('.term')) hideTip(); });
document.addEventListener('focusin', e => { const t = e.target.closest?.('.term'); if (t) showTip(t); });
document.addEventListener('focusout', e => { if (e.target.closest?.('.term')) hideTip(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
window.addEventListener('scroll', hideTip, { passive: true });

// ─── The funnel: the chain from a top-level intent down to where you are reading, following as you scroll ─

let shown = null;                  // the report on screen
const treeIndex = new Map();       // ref → node; an intent with two parents is one node
const short = (s, max = 60) => (s = String(s ?? '')).length > max ? `${s.slice(0, max - 1)}…` : s;

function updateFunnel() {
  const funnel = $('#funnel'), trail = $('#trail');
  if (!funnel || !shown) return;
  const bar = $('.bar').offsetHeight;
  document.documentElement.style.setProperty('--bar-h', `${bar}px`);
  let at = null;   // the last intent whose heading has passed the reading line
  for (const el of document.querySelectorAll('.tree .intent')) {
    if (el.querySelector(':scope > .node').getBoundingClientRect().top <= bar + 90) at = el; else break;
  }
  at ??= document.querySelector('.tree .intent');
  if (!at) return;
  const chain = at.dataset.key.split('>');
  const key = i => esc(chain.slice(0, i + 1).join('>'));
  funnel.innerHTML = `<p class="funnel-label">You are in</p><ol>${chain.map((ref, i) => {
    const n = treeIndex.get(ref), depth = chain.length - 1 - i;
    return `<li class="funnel-card${depth === 0 ? ' current' : ''}" style="--d:${depth}">
      <button type="button" data-goto="${key(i)}"><span class="cov ${n.coverage}" aria-label="${n.coverage}"></span><span class="funnel-text">${esc(n.statement)}</span></button>
      <p class="reason">${depth === 0 ? esc(coverageReason(n, shown.claims)) : n.children.length ? `needs ${n.combine} of its parts` : ''}</p>
    </li>`;
  }).join('')}</ol>`;
  trail.innerHTML = chain.map((ref, i) => {
    const n = treeIndex.get(ref);
    return `<button type="button" class="crumb" data-goto="${key(i)}"><span class="cov ${n.coverage}" aria-label="${n.coverage}"></span>${esc(short(n.statement, 42))}</button>`;
  }).join('<span class="sep" aria-hidden="true">›</span>');
}

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; updateFunnel(); });
}, { passive: true });
window.addEventListener('resize', updateFunnel);
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-goto]');
  if (!b) return;
  const target = document.querySelector(`.tree .intent[data-key="${CSS.escape(b.dataset.goto)}"]`);
  target?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

function render(r) {
  shown = r;
  treeIndex.clear();
  const walk = n => { treeIndex.set(n.ref, n); n.children.forEach(walk); };
  r.tree.forEach(walk);
  $('#doc').innerHTML = renderReport(r);
  renderPanel(r);
  updateFunnel();
}

// ─── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  readUrl();
  source = await findSource();

  const [contracts, societies] = await Promise.all([source.contracts(), source.societies()]).catch(err => { fail(err.message); return []; });
  if (!contracts) return;
  if (!contracts.length) return fail('The store has no contracts yet.');
  if (!contracts.some(c => c.id === state.contract)) state.contract = (contracts.find(c => c.status !== 'proposed') ?? contracts[0]).id;

  const contractSelect = $('#contract');
  const option = c => `<option value="${esc(c.id)}">${esc(c.title)} (${c.scale === 'social' ? 'milli' : 'micro'} · ${esc(c.status)})</option>`;
  const group = (label, list) => list.length ? `<optgroup label="${label}">${list.map(option).join('')}</optgroup>` : '';
  contractSelect.innerHTML = group('Contracts', contracts.filter(c => c.status !== 'proposed'))
    + group('Proposals', contracts.filter(c => c.status === 'proposed'));
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
