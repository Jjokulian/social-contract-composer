// The graphical composer. Drag contracts, intents, clauses, definitions and consequences from the library onto the
// canvas. The composition is composed and evaluated live by the same engine the server uses. Drafts stay in this
// browser; "Submit as a doubt" opens a pre-filled GitHub issue, which is digested into a proposal everyone can see.
import { compose } from './compose.mjs';
import { evaluate } from './evaluate.mjs';

const REPO = 'https://github.com/Jjokulian/social-contract-composer';
const KEY = 'composer-draft-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (s, max = 90) => (s = String(s ?? '')).length > max ? `${s.slice(0, max - 1)}…` : s;

let cat, draft;

// ─── Catalogue ───────────────────────────────────────────────────────────────

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${path}`);
  return body;
}
// With a server, read the live catalogue; on a static host, the one baked at build time.
const loadCatalogue = () => getJSON('api/config').then(() => getJSON('api/catalogue'), () => getJSON('data/catalogue.json'));

const latest = list => { const by = new Map(); for (const x of list) if (!by.has(x.id) || by.get(x.id).rev < x.rev) by.set(x.id, x); return [...by.values()]; };
const latestContracts = () => latest(Object.values(cat.contracts)).filter(c => c.status !== 'retired');
const latestNanos = kind => latest(Object.values(cat.nanos).filter(n => n.kind === kind));
const everything = () => ({ ...cat.nanos, ...draft.nanos });
const nano = ref => everything()[ref] ?? { ref };
const text = n => n.statement ?? n.text ?? n.meaning ?? n.label ?? n.ref;

// ─── Drafts ──────────────────────────────────────────────────────────────────

const blank = () => ({ id: 'draft', scale: 'social', title: 'My Social Contract', territory: '', status: 'draft',
  intents: [], edges: [], members: [], parameters: {}, includes: [], breaches: [], enforcement: [], socioship: [],
  operations: [], resolution: [], nanos: {} });

// The maxims a milli may resolve conflicts by, in their customary order: a later general law does not repeal an earlier
// special one (lex posterior generalis non derogat priori speciali), so specialis comes before posterior.
const MAXIM_ORDER = ['superior', 'specialis', 'posterior'];
const MAXIM_LABEL = { superior: 'lex superior: the base outranks', specialis: 'lex specialis: the special prevails', posterior: 'lex posterior: the later prevails' };

const BINDING_TIP = { work: 'Work to carry out', abide: 'A rule to abide by; breaches must be detected', liberty: 'A liberty; no one is bound to act' };
const bindingChip = n => n.binding ? `<span class="binding ${n.binding}" title="${BINDING_TIP[n.binding]}">${n.binding}</span>` : '';
const roleLabel = id => cat.roles?.find(r => r.id === id)?.label ?? id;
const roleId = label => cat.roles?.find(r => r.label.toLowerCase() === label.trim().toLowerCase() || r.id === label.trim())?.id ?? label.trim();

function example() {
  const d = blank();
  const base = latestContracts().find(c => c.id === 'pro-pregnancy' && c.status !== 'proposed');
  if (base) d.includes.push({ ref: base.ref, mode: 'add', under: null });
  return d;
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Array.isArray(saved.intents)) return { ...blank(), ...saved };
  } catch { /* no storage here: start from the example */ }
  return example();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch { /* private window: the draft lasts for this visit */ }
}

const ensureIntent = ref => { if (!draft.intents.some(i => i.ref === ref)) draft.intents.push({ ref, combine: 'all' }); };
const contractId = ref => String(ref).split('@')[0];

const ops = {
  addContract(ref, under = null) {
    draft.includes = draft.includes.filter(i => contractId(i.ref) !== contractId(ref));   // one revision per contract
    if (under) ensureIntent(under);
    draft.includes.push({ ref, mode: under ? 'nest' : 'add', under });
  },
  addIntent(ref, parent = null) {
    ensureIntent(ref);
    if (parent && parent !== ref) {
      ensureIntent(parent);
      if (!draft.edges.some(e => e.child === ref && e.parent === parent)) draft.edges.push({ child: ref, parent });
    }
  },
  addMember(ref) { if (!draft.members.includes(ref)) draft.members.push(ref); },
  addClaim(clause, intent) {
    const n = 1 + Math.max(0, ...Object.values(draft.nanos).map(x => Number(x.id.split('-').pop())));
    const ref = `draft-claim-${n}@1`;
    draft.nanos[ref] = { kind: 'claim', ref, id: `draft-claim-${n}`, rev: 1, rid: 1e9 + n, from: clause, relation: 'supports', to: intent,
      strength: 'contributes', rationale: '', given: [], when: [], assuming: [], measuredBy: [], filedBy: 'you', source: 'draft' };
    ops.addMember(clause);
    ops.addMember(ref);
  },
  attach(clause, consequence) {
    if (!draft.breaches.some(b => b.clause === clause && b.consequence === consequence)) draft.breaches.push({ clause, consequence });
  },
  removeInclude(ref) { draft.includes = draft.includes.filter(i => i.ref !== ref); },
  removeIntent(ref) {
    draft.intents = draft.intents.filter(i => i.ref !== ref);
    draft.edges = draft.edges.filter(e => e.child !== ref && e.parent !== ref);
    draft.includes = draft.includes.map(i => i.under === ref ? { ...i, mode: 'add', under: null } : i);
  },
  removeMember(ref) {
    for (const c of Object.values(draft.nanos)) if (c.from === ref) ops.removeClaim(c.ref);
    draft.members = draft.members.filter(m => m !== ref);
    draft.breaches = draft.breaches.filter(b => b.clause !== ref);
    draft.socioship = draft.socioship.filter(s => s.nano !== ref);
  },
  toggleBase(ref) { draft.includes = draft.includes.map(i => i.ref === ref ? { ...i, base: !i.base } : i); },
  derogate(ref) { if (!draft.operations.some(o => o.op === 'derogate' && o.nano === ref)) draft.operations.push({ op: 'derogate', nano: ref }); },
  undoOperation(index) { draft.operations.splice(index, 1); },
  setMaxim(maxim, on) {
    const chosen = new Set(draft.resolution);
    if (on) chosen.add(maxim); else chosen.delete(maxim);
    draft.resolution = MAXIM_ORDER.filter(m => chosen.has(m));
  },
  define(term, ref) { if (!draft.socioship.some(s => s.term === term && s.nano === ref)) draft.socioship.push({ term, nano: ref }); },
  undefine(term, ref) { draft.socioship = draft.socioship.filter(s => !(s.term === term && s.nano === ref)); },
  removeClaim(ref) { delete draft.nanos[ref]; draft.members = draft.members.filter(m => m !== ref); },
  detach(clause, consequence) { draft.breaches = draft.breaches.filter(b => !(b.clause === clause && b.consequence === consequence)); },
};

function dropOn(target, targetRef, { type, ref }) {
  const hint = message => status(message);
  if (type === 'consequence' && target !== 'clause') return hint('Drop a consequence onto a clause under “If a clause is breached”.');
  if (target === 'root') {
    const via = draft.includes.map(i => cat.contracts[i.ref]).find(c => c?.intents.some(x => x.ref === ref) || c?.members.includes(ref));
    if (via) return hint(`Already in the composition, through ${via.title}. Drop it onto an intent to nest it there, or onto a clause’s row to use it.`);
    if (type === 'contract') ops.addContract(ref);
    else if (type === 'intent') ops.addIntent(ref);
    else ops.addMember(ref);
  } else if (target === 'intent') {
    if (type === 'contract') ops.addContract(ref, targetRef);
    else if (type === 'intent') ops.addIntent(ref, targetRef);
    else if (type === 'clause') ops.addClaim(ref, targetRef);
    else ops.addMember(ref);
  } else if (target === 'clause') {
    if (type !== 'consequence') return hint('Only consequences attach to a clause.');
    ops.attach(targetRef, ref);
  }
  status('');
  change();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function status(message) { $('#status').textContent = message; }

function renderLibrary() {
  const q = $('#lib-search').value.trim().toLowerCase();
  const item = (type, ref, label, sub) => `
    <li class="lib-item" draggable="true" data-drag-type="${type}" data-drag-ref="${esc(ref)}" title="${esc(label)}">
      <span class="grip" aria-hidden="true"></span>
      <span class="lib-text"><span>${esc(short(label, 110))}</span><span class="ref">${esc(sub)}</span></span>
      ${type === 'consequence' ? '' : `<button type="button" class="x add" data-action="add" data-type="${type}" data-ref="${esc(ref)}" aria-label="Add to the composition: ${esc(short(label, 50))}">+</button>`}
    </li>`;
  const groups = [
    ['contract', 'Contracts', latestContracts().map(c => [c.ref, c.title, `${c.ref} · ${c.status}`])],
    ['intent', 'Intents', latestNanos('intent').map(n => [n.ref, n.statement, n.ref])],
    ['clause', 'Clauses', latestNanos('clause').map(n => [n.ref, `${n.modality.toUpperCase()} · ${n.text}`, n.ref])],
    ['definition', 'Definitions', latestNanos('definition').map(n => [n.ref, `${n.termLabel}: ${n.meaning}`, n.ref])],
    ['consequence', 'Consequences', latestNanos('consequence').map(n => [n.ref, n.statement, 'drag onto a clause'])],
  ];
  $('#library-groups').innerHTML = groups.map(([type, label, items]) => {
    const shown = items.filter(([ref, t]) => !q || t.toLowerCase().includes(q) || ref.includes(q));
    return `<section class="lib-group"><h2>${label} <span class="n">${shown.length}</span></h2><ul>${shown.map(([ref, t, sub]) => item(type, ref, t, sub)).join('')}</ul></section>`;
  }).join('');
}

function renderCanvas(out) {
  const coverage = new Map();
  const walk = n => { coverage.set(n.ref, n.coverage); n.children.forEach(walk); };
  out?.r.tree.forEach(walk);
  const chip = ref => coverage.has(ref) ? `<span class="cov ${coverage.get(ref)}">${coverage.get(ref)}</span>` : '';

  const intentRow = (ref, own, depth = 0) => {
    const kids = draft.edges.filter(e => e.parent === ref);
    return `
      <li class="row-wrap">
        <div class="row" data-drop="intent" data-ref="${esc(ref)}">
          ${chip(ref)}<span class="row-text">${esc(text(nano(ref)))}</span>
          ${own ? `<button type="button" class="x" data-action="remove-intent" data-ref="${esc(ref)}" aria-label="Remove this intent">×</button>` : ''}
        </div>
        ${kids.length && depth < 6 ? `<ul class="rows">${kids.map(e => intentRow(e.child, true, depth + 1)).join('')}</ul>` : ''}
      </li>`;
  };

  const blocks = draft.includes.map(i => {
    const c = cat.contracts[i.ref];
    const roots = c ? c.intents.filter(x => !c.edges.some(e => e.child === x.ref)) : [];
    return `
      <div class="block">
        <div class="block-head">
          <strong>${esc(c?.title ?? i.ref)}</strong>
          <span class="chip">${i.mode === 'nest' ? `nested under “${esc(short(text(nano(i.under)), 40))}”` : 'added'}</span>
          <button type="button" class="chip toggle${i.base ? ' on' : ''}" data-action="base" data-ref="${esc(i.ref)}" aria-pressed="${Boolean(i.base)}"
            title="The base ranks first when lex superior resolves a conflict">base</button>
          <button type="button" class="x" data-action="remove-include" data-ref="${esc(i.ref)}" aria-label="Remove ${esc(c?.title ?? i.ref)}">×</button>
        </div>
        <span class="ref">${esc(i.ref)}${c?.status === 'proposed' ? ' · a proposal' : ''}</span>
        <ul class="rows">${roots.map(r => intentRow(r.ref, false)).join('')}</ul>
      </div>`;
  }).join('');

  const included = new Set(draft.includes.flatMap(i => cat.contracts[i.ref]?.intents.map(x => x.ref) ?? []));
  const ownRoots = draft.intents.filter(i => !draft.edges.some(e => e.child === i.ref) && !included.has(i.ref));
  const members = draft.members.filter(m => !draft.nanos[m]);
  const claims = Object.values(draft.nanos).filter(n => n.kind === 'claim');
  const clauses = out?.snap.clauses ?? [];
  const inherited = new Map((out?.r.breaches ?? []).filter(b => b.setBy !== '(draft)').map(b => [b.clause, b]));
  const consequences = latestNanos('consequence');
  const definers = [...clauses, ...Object.values(out?.snap.nanos ?? {}).filter(n => n.kind === 'definition').map(n => n.ref)];

  $('#canvas-body').innerHTML = `
    <div class="drop" data-drop="root">Drop a contract, intent, clause or definition here. Drop onto an intent to nest a contract, refine the intent, or claim that a clause serves it.</div>

    <section class="canvas-section"><h2>Contracts</h2>
      ${blocks || '<p class="empty">No contracts yet. Drag one from the library.</p>'}
    </section>

    <section class="canvas-section"><h2>Your intents</h2>
      ${ownRoots.length ? `<ul class="rows">${ownRoots.map(i => intentRow(i.ref, true)).join('')}</ul>` : '<p class="empty">None of your own yet. Drop intents here or onto another intent.</p>'}
    </section>

    <section class="canvas-section"><h2>Your clauses and definitions</h2>
      ${members.length ? `<ul class="rows">${members.map(m => `
        <li class="row"><span class="modality">${esc(nano(m).modality ?? nano(m).termLabel ?? '')}</span>${bindingChip(nano(m))}<span class="row-text">${esc(short(text(nano(m)), 140))}</span>
        <button type="button" class="x" data-action="remove-member" data-ref="${esc(m)}" aria-label="Remove">×</button></li>`).join('')}</ul>`
        : '<p class="empty">None yet.</p>'}
    </section>

    <section class="canvas-section"><h2>Your claims</h2>
      ${claims.length ? claims.map(c => `
        <div class="claim-edit">
          <span class="row-text">${esc(short(text(nano(c.from)), 80))}</span>
          <select data-action="relation" data-ref="${esc(c.ref)}" aria-label="Relation">
            <option value="supports"${c.relation === 'supports' ? ' selected' : ''}>supports</option>
            <option value="hinders"${c.relation === 'hinders' ? ' selected' : ''}>hinders</option>
          </select>
          <span class="row-text">${esc(short(text(nano(c.to)), 80))}</span>
          <input class="text-input" data-action="rationale" data-ref="${esc(c.ref)}" value="${esc(c.rationale)}" placeholder="Why do you believe this?" aria-label="Rationale">
          <button type="button" class="x" data-action="remove-claim" data-ref="${esc(c.ref)}" aria-label="Remove this claim">×</button>
        </div>`).join('') : '<p class="empty">Drop a clause onto an intent to claim that it serves the intent.</p>'}
    </section>

    <datalist id="roles-list">${(cat.roles ?? []).map(r => `<option value="${esc(r.label)}"></option>`).join('')}</datalist>
    <section class="canvas-section"><h2>If a clause is breached</h2>
      <p class="lede">Your composition sets the consequences, and outranks any set by the contracts it includes. The parties can reverse a consequence by agreement.</p>
      ${clauses.length ? `<ul class="rows">${clauses.map(cl => {
        const own = draft.breaches.filter(b => b.clause === cl);
        const theirs = own.length ? [] : (inherited.get(cl)?.consequences ?? []);
        const hasConsequence = own.length || theirs.length;
        const ownEnforcer = draft.enforcement.find(e => e.clause === cl);
        const theirEnforcer = out?.r.enforcement.find(e => e.clause === cl && e.setBy !== '(draft)');
        return `
          <li class="row breach-row" data-drop="clause" data-ref="${esc(cl)}">
            ${bindingChip(nano(cl))}<span class="row-text">${esc(short(text(nano(cl)), 120))}</span>
            ${hasConsequence ? `<input class="text-input enforcer" list="roles-list" data-action="enforcer" data-clause="${esc(cl)}"
              value="${esc(ownEnforcer ? roleLabel(ownEnforcer.by) : '')}"
              placeholder="${esc(theirEnforcer ? `Detected by ${theirEnforcer.by.map(roleLabel).join(', ')} (set by ${theirEnforcer.setBy})` : 'Detected and enforced by… (no one yet)')}"
              aria-label="Who detects breaches of this clause and applies its consequences">` : ''}
            <span class="breach-chips">
              ${draft.members.includes(cl) ? '' : `<button type="button" class="chip toggle" data-action="derogate" data-ref="${esc(cl)}"
                title="Derogate: set this included clause aside in your milli; it stays listed under Operators">derogate</button>`}
              ${own.map(b => `<span class="chip consequence">${esc(text(nano(b.consequence)))}<button type="button" class="x" data-action="detach" data-clause="${esc(cl)}" data-ref="${esc(b.consequence)}" aria-label="Detach">×</button></span>`).join('')}
              ${theirs.map(c => `<span class="chip consequence inherited" title="set by ${esc(inherited.get(cl).setBy)}">${esc(text(nano(c)))}</span>`).join('')}
              <select data-action="attach" data-clause="${esc(cl)}" aria-label="Attach a consequence">
                <option value="">Attach…</option>${consequences.map(c => `<option value="${esc(c.ref)}">${esc(c.statement)}</option>`).join('')}
              </select>
            </span>
          </li>`;
      }).join('')}</ul>` : '<p class="empty">No clauses in the composition yet.</p>'}
    </section>

    <section class="canvas-section"><h2>Operators and resolution</h2>
      <p class="lede">Mark an included contract as the base, derogate an included clause from its row above, and choose the maxims that resolve the conflicts no operator settles. Nothing is deleted: what you set aside stays listed here.</p>
      ${draft.operations.length ? `<ul class="rows">${draft.operations.map((o, i) => `
        <li class="row"><span class="modality">${esc(o.op)}</span><span class="row-text"><s>${esc(short(text(nano(o.nano)), 120))}</s></span>
        <button type="button" class="x" data-action="undo-operation" data-index="${i}" aria-label="Undo this ${esc(o.op)}">×</button></li>`).join('')}</ul>`
        : '<p class="empty">No operators yet.</p>'}
      <fieldset class="layers"><legend>Resolve conflicts by</legend>
        ${MAXIM_ORDER.map(m => `<label><input type="checkbox" data-action="maxim" data-maxim="${m}"${draft.resolution.includes(m) ? ' checked' : ''}> ${MAXIM_LABEL[m]}</label>`).join('')}
      </fieldset>
    </section>

    <section class="canvas-section"><h2>Socioship</h2>
      <p class="lede">Socioship is having signed your milli together with other persons. Your milli defines the terms on which it is held: pick the clauses or definitions that define each. A term you leave undefined is a gap, unless it has a default.</p>
      <ul class="rows">${(cat.socioshipTerms ?? []).map(t => {
        const own = draft.socioship.filter(s => s.term === t.id);
        const got = out?.r.socioship?.find(x => x.id === t.id);
        const theirs = own.length || !got?.setBy || got.setBy === '(draft)' ? [] : got.nanos;
        return `
          <li class="row breach-row">
            <span class="row-text"><strong>${esc(t.label)}</strong><br><span class="lib-hint">${esc(t.asks)}</span></span>
            <span class="breach-chips">
              ${own.map(s => `<span class="chip">${esc(short(text(nano(s.nano)), 60))}<button type="button" class="x" data-action="undefine" data-term="${esc(t.id)}" data-ref="${esc(s.nano)}" aria-label="Remove">×</button></span>`).join('')}
              ${theirs.map(n => `<span class="chip inherited" title="set by ${esc(got.setBy)}">${esc(short(text(nano(n)), 60))}</span>`).join('')}
              ${own.length || theirs.length ? '' : t.defaultRule ? `<span class="chip inherited" title="${esc(t.defaultRule)}">default holds</span>` : '<span class="chip gap">not defined</span>'}
              <select data-action="define" data-term="${esc(t.id)}" aria-label="Define “${esc(t.label)}” with">
                <option value="">Defined by…</option>${definers.map(ref => `<option value="${esc(ref)}">${esc(short(text(nano(ref)), 70))}</option>`).join('')}
              </select>
            </span>
          </li>`;
      }).join('')}</ul>
    </section>`;
}

function renderReport() {
  let snap, r;
  try {
    snap = compose({ ...cat, nanos: everything() }, draft);
    r = evaluate(snap, {});
  } catch (err) {
    $('#report').innerHTML = `<h2>Live report</h2><p class="notice error">${esc(err.message)}</p><button type="button" class="btn" data-action="reset">Reset to the example</button>`;
    return null;
  }
  const flat = [];
  const walk = n => { if (!flat.some(f => f.ref === n.ref)) flat.push(n); n.children.forEach(walk); };
  r.tree.forEach(walk);
  const count = level => flat.filter(n => n.coverage === level).length;
  const c = r.checks;
  const list = (items, render) => items.length ? `<ul class="report-list">${items.map(x => `<li>${render(x)}</li>`).join('')}</ul>` : '';
  const rows = [
    ['Conflicts', c.conflicts.length], ['Definition clashes', c.definitionClashes.length], ['Intents with a gap', c.gaps.length],
    ['Tensions', c.tensions.length], ['Disagreements', c.disagreements.length], ['Clauses with consequences', r.breaches.length],
    ['Consequences no one detects', c.unenforced.length], ['Socioship terms not defined', c.socioshipGaps.length],
    ['Operators', c.operations.length], ['Conflicts no maxim decides', c.conflicts.filter(x => !x.resolution).length],
  ];
  $('#report').innerHTML = `
    <section>
      <h2>Live report</h2>
      <div class="coverage-bar" role="img" aria-label="${count('claimed')} claimed, ${count('thin')} thin, ${count('gap')} gap">
        ${['claimed', 'thin', 'gap'].map(l => count(l) ? `<span class="swatch-${l}" style="flex:${count(l)}"></span>` : '').join('')}
      </div>
      <div class="legend"><span class="cov claimed">${count('claimed')}</span><span class="cov thin">${count('thin')}</span><span class="cov gap">${count('gap')}</span></div>
    </section>
    <section>
      <ul class="tally">${rows.map(([label, n]) => `<li><span class="tally-row"><span>${label}</span><span class="n${n ? '' : ' zero'}">${n}</span></span></li>`).join('')}</ul>
    </section>
    ${c.conflicts.length ? `<section><h2>Conflicts</h2>${list(c.conflicts, x => `${esc(short(text(nano(x.between[0])), 60))} <em>conflicts with</em> ${esc(short(text(nano(x.between[1])), 60))}`)}</section>` : ''}
    ${c.definitionClashes.length ? `<section><h2>Definition clashes</h2>${list(c.definitionClashes, x => `“${esc(x.term)}” is defined twice`)}</section>` : ''}
    ${c.gaps.length ? `<section><h2>Gaps</h2>${list(c.gaps, ref => esc(short(text(nano(ref)), 90)))}</section>` : ''}
    ${r.breaches.length ? `<section><h2>Consequences of breach</h2>${list(r.breaches, b => `${esc(short(text(nano(b.clause)), 60))} → ${b.consequences.map(x => esc(text(nano(x)))).join('; ')}`)}</section>` : ''}
    <p class="lib-hint">Evaluated by the same engine as stored contracts. Your draft stays in this browser until you submit it.</p>`;
  return { snap, r };
}

function change() {
  save();
  renderCanvas(renderReport());
}

// ─── Submitting a composition as a doubt ─────────────────────────────────────

function submit() {
  const bullets = items => items.map(x => `- ${x}`).join('\n') || '- none';
  const summary = [
    `**Territory:** ${draft.territory || 'not stated'}`, '',
    '**Contracts included**', bullets(draft.includes.map(i => `\`${i.ref}\` ${i.mode === 'nest' ? `nested under \`${i.under}\`` : 'added'}${i.base ? ', as the base' : ''}`)), '',
    '**Operators**', bullets(draft.operations.map(o => `${o.op} \`${o.nano}\`: ${short(text(nano(o.nano)), 100)}`)), '',
    `**Resolves conflicts by:** ${draft.resolution.map(m => MAXIM_LABEL[m]).join('; then ') || 'no maxims'}`, '',
    '**Own intents**', bullets(draft.intents.map(i => `${text(nano(i.ref))} (\`${i.ref}\`)`)), '',
    '**Own clauses and definitions**', bullets(draft.members.filter(m => !draft.nanos[m]).map(m => `${short(text(nano(m)), 120)} (\`${m}\`)`)), '',
    '**Consequences of breach**', bullets(draft.breaches.map(b => `\`${b.clause}\` → ${text(nano(b.consequence))}`)), '',
    '**Who detects breaches**', bullets(draft.enforcement.map(e => `\`${e.clause}\` → ${e.by.map(roleLabel).join(', ')}`)), '',
    '**Socioship**', bullets((cat.socioshipTerms ?? []).map(t => {
      const own = draft.socioship.filter(s => s.term === t.id);
      return `${t.label}: ${own.length ? own.map(s => `\`${s.nano}\``).join(', ') : t.defaultRule ? 'the default holds' : 'not defined'}`;
    })), '',
    '**Claims**', bullets(Object.values(draft.nanos).map(c => `\`${c.from}\` ${c.relation} \`${c.to}\`: ${c.rationale || 'no rationale given'}`)), '',
    '<details><summary>Composition, for digesting</summary>', '', '```json', JSON.stringify(draft), '```', '', '</details>',
  ].join('\n');
  const title = `Composition: ${draft.title}`;
  const params = new URLSearchParams({ template: 'proposition.yml', title, contract: draft.includes.map(i => i.ref).join(', ') || 'none', proposition: summary });
  let url = `${REPO}/issues/new?${params}`;
  if (url.length > 7500) {
    navigator.clipboard?.writeText(summary).catch(() => {});
    url = `${REPO}/issues/new?${new URLSearchParams({ template: 'proposition.yml', title })}`;
    status('The composition is too long for a link, so it was copied. Paste it into “What you raise” in the issue that opened.');
  }
  window.open(url, '_blank', 'noopener');
}

// ─── Events ──────────────────────────────────────────────────────────────────

document.addEventListener('dragstart', e => {
  const el = e.target.closest?.('[data-drag-type]');
  if (!el) return;
  e.dataTransfer.setData('application/json', JSON.stringify({ type: el.dataset.dragType, ref: el.dataset.dragRef }));
  e.dataTransfer.effectAllowed = 'copy';
});
document.addEventListener('dragover', e => {
  const target = e.target.closest?.('[data-drop]');
  if (!target) return;
  e.preventDefault();
  document.querySelectorAll('.over').forEach(x => { if (x !== target) x.classList.remove('over'); });
  target.classList.add('over');
});
document.addEventListener('dragleave', e => {
  const target = e.target.closest?.('[data-drop]');
  if (target && !target.contains(e.relatedTarget)) target.classList.remove('over');
});
document.addEventListener('drop', e => {
  const target = e.target.closest?.('[data-drop]');
  if (!target) return;
  e.preventDefault();
  target.classList.remove('over');
  try { dropOn(target.dataset.drop, target.dataset.ref, JSON.parse(e.dataTransfer.getData('application/json'))); } catch { /* not ours */ }
});

document.addEventListener('click', e => {
  const b = e.target.closest?.('button[data-action]');
  if (!b) return;
  const { action, ref, type, clause, term } = b.dataset;
  if (action === 'add') return dropOn('root', null, { type, ref });
  if (action === 'submit') return submit();
  if (action === 'reset') { draft = example(); fillHead(); }
  else if (action === 'clear') { draft = { ...blank(), title: draft.title, territory: draft.territory }; }
  else if (action === 'remove-include') ops.removeInclude(ref);
  else if (action === 'remove-intent') ops.removeIntent(ref);
  else if (action === 'remove-member') ops.removeMember(ref);
  else if (action === 'remove-claim') ops.removeClaim(ref);
  else if (action === 'detach') ops.detach(clause, ref);
  else if (action === 'undefine') ops.undefine(term, ref);
  else if (action === 'base') ops.toggleBase(ref);
  else if (action === 'derogate') ops.derogate(ref);
  else if (action === 'undo-operation') ops.undoOperation(Number(b.dataset.index));
  else return;
  change();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset?.action === 'attach' && el.value) { ops.attach(el.dataset.clause, el.value); change(); }
  else if (el.dataset?.action === 'define' && el.value) { ops.define(el.dataset.term, el.value); change(); }
  else if (el.dataset?.action === 'maxim') { ops.setMaxim(el.dataset.maxim, el.checked); change(); }
  else if (el.dataset?.action === 'relation') { draft.nanos[el.dataset.ref].relation = el.value; change(); }
  else if (el.dataset?.action === 'rationale') { draft.nanos[el.dataset.ref].rationale = el.value; save(); }
  else if (el.dataset?.action === 'enforcer') {
    draft.enforcement = draft.enforcement.filter(x => x.clause !== el.dataset.clause);
    if (el.value.trim()) draft.enforcement.push({ clause: el.dataset.clause, by: [roleId(el.value)] });
    change();
  }
});

function fillHead() {
  $('#draft-title').value = draft.title;
  $('#draft-territory').value = draft.territory;
}

async function boot() {
  try { cat = await loadCatalogue(); }
  catch (err) { $('#canvas-body').innerHTML = `<p class="notice error">${esc(err.message)}</p>`; return; }
  draft = restore();
  fillHead();
  $('#draft-title').addEventListener('input', e => { draft.title = e.target.value; save(); });
  $('#draft-territory').addEventListener('input', e => { draft.territory = e.target.value; save(); });
  $('#lib-search').addEventListener('input', renderLibrary);
  renderLibrary();
  change();
}

boot();
