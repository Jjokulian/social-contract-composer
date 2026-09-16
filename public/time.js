// The Timeline: the demesnes of a coordinate space over time. Drag along the strip — or press Play — and the globe, the
// counts and the lists follow the instant. The strip shows how many demesnes were in force at each nesting level, and
// marks every instant at which one began, one ended, or one came after another. State lives in the URL
// (?space=…&when=…&example=0|1), so a moment can be linked.
//
// What the strip draws is a magnitude over time, so its bands take one hue, light to dark by nesting level, and the
// deepest levels fold into the last band. The values are never colour alone: the readout, the legend and the table
// below give the same numbers.
import { findSource } from './source.mjs';
import { layering, layersOf, paint, currentDemesnes, instant, inForce, dateOf, bbox } from './space.mjs';
import { extent, samples, eventsOf, ticksOf, yearLabel, levelAt } from './timeline.mjs';
import { EXAMPLE } from './example-demesnes.mjs';
import { swatch, cueOf as cueFor, styleFor, featuresOf, addDemesneLayers } from './map.mjs';
import { $, esc, CASES, casesOf, caseParam, inCase } from './common.mjs';

const YEAR = 372;                  // instants count in days of twelve 31-day months (public/space.mjs)
const BANDS = 4;                   // levels deeper than this fold into the last band
const STEPS = 240;                 // instants sampled across the span
const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const RAMP = ['#5c1f42', '#8a2f63', '#b4508a', '#d68fb5'];   // the light theme's steps; the tokens carry either theme's
const bandColour = k => token(`--level-${k + 1}`, RAMP[k]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ─── State ───────────────────────────────────────────────────────────────────

const state = { space: 'earth', when: null, example: null, cases: new Set(Object.keys(CASES)) };
let data, map, all = [], span = null, containers = new Map(), series = [], events = [];
let layered = [], cues = new Map(), at = 0, hover = null, playing = null, frame = null;

function readUrl() {
  const q = new URLSearchParams(location.search);
  state.space = q.get('space') ?? 'earth';
  state.when = q.get('when') || null;
  state.example = q.has('example') ? q.get('example') === '1' : null;
  state.cases = casesOf(location.search, Object.keys(CASES));   // a view of what was: every case, unless asked otherwise
}

// An instant on a first of January is written as its year alone: the year is what a viewer reads and links.
const whenText = n => { const d = dateOf(n); return d.endsWith('-01-01') ? d.slice(0, -6) : d; };

function writeUrl() {
  const q = new URLSearchParams({ space: state.space });
  if (span) q.set('when', whenText(at));
  if (state.example !== null) q.set('example', state.example ? '1' : '0');
  if (caseParam(state.cases) !== null) q.set('case', caseParam(state.cases));
  history.replaceState(null, '', `?${q}`);
}

const showingExample = () => state.space === 'earth' && (state.example ?? !data.demesnes.some(d => d.space === 'earth'));
const everyDemesne = () => [...data.demesnes, ...(showingExample() ? EXAMPLE : [])];
const nameOfAny = ref => esc(everyDemesne().find(d => d.ref === ref)?.name ?? ref);
const fold = byLevel => { const out = Array(BANDS).fill(0); byLevel.forEach((n, k) => { out[Math.min(k, BANDS - 1)] += n; }); return out; };

// What a set of demesnes spans, which of them contain which, how many were in force across it, and what happened.
// Containment follows from the segments and is worked out once, so dragging never waits on the geometry; the level a
// demesne lies at is counted at each instant, from the containers in force then.
function prepare() {
  all = currentDemesnes(everyDemesne()).filter(d => d.space === state.space && inCase(d, state.cases));
  containers = new Map(layering(all, state.space).map(d => [d.ref, new Set(d.within)]));
  span = extent(all);
  series = span ? samples(all, span, containers, STEPS) : [];
  events = eventsOf(all);
  const asked = state.when && instant(state.when)?.start;
  at = asked ?? events.at(-1)?.at ?? span?.end ?? 0;
  if (span) at = Math.min(Math.max(at, span.start), span.end);
}

// The nesting as it was at the instant, and the cues to draw it with.
function atInstant() {
  layered = layering(all, state.space, { when: { start: at, end: at } });
  const layers = layersOf(layered, 'level');
  cues = paint(layered, layers, new Set(layers.map(l => l.key)));
}

// ─── The strip ───────────────────────────────────────────────────────────────

// What was in force at one instant, counted at the level each demesne lies at. The strip's samples give the shape of
// the span; every number a viewer reads is counted at the instant itself, so the readout, the legend, the tooltip and
// the list below never disagree.
function countsAt(n) {
  const now = all.filter(d => inForce(d, { start: n, end: n }));
  const inForceNow = new Set(now.map(d => d.ref));
  const byLevel = [];
  for (const d of now) {
    const k = levelAt(d.ref, containers, inForceNow) - 1;
    byLevel[k] = (byLevel[k] ?? 0) + 1;
  }
  return { byLevel: Array.from(byLevel, v => v ?? 0), total: now.length };
}

const xOf = (n, plot) => plot.x + ((n - span.start) / (span.end - span.start)) * plot.w;
const instantAt = (px, plot) => Math.round(span.start + ((px - plot.x) / plot.w) * (span.end - span.start));
const plotOf = (width, height) => ({ x: 10, y: 12, w: width - 20, h: height - 12 - 30 });

function drawChart() {
  const canvas = $('#chart'), ctx = canvas.getContext('2d');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!span || !series.length) return;

  const plot = plotOf(width, height);
  const surface = token('--surface', '#fff'), rule = token('--rule', '#d9ddd4'), ink3 = token('--ink-3', '#78817b'), ink = token('--ink', '#1b211e');
  const most = Math.max(1, ...series.map(s => s.total));
  const x = n => xOf(n, plot);
  const y = v => plot.y + plot.h - (v / most) * plot.h;
  ctx.font = `11px ${token('--sans', 'sans-serif')}`;
  ctx.textBaseline = 'middle';

  // A hairline grid, one shade off the surface, at round counts.
  const step = most <= 5 ? 1 : most <= 12 ? 2 : most <= 30 ? 5 : 10;
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.fillStyle = ink3;
  for (let v = 0; v <= most; v += step) {
    const gy = Math.round(y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.x, gy);
    ctx.lineTo(plot.x + plot.w, gy);
    ctx.stroke();
    if (v) ctx.fillText(String(v), plot.x + 2, gy - 7);
  }

  // The bands, outermost level at the bottom, then a surface-coloured gap along each boundary.
  const stacked = series.map(s => fold(s.byLevel));
  const below = series.map(() => 0);
  for (let k = 0; k < BANDS; k++) {
    if (!stacked.some(s => s[k])) continue;
    ctx.beginPath();
    series.forEach((s, i) => { const v = below[i] + stacked[i][k]; ctx[i ? 'lineTo' : 'moveTo'](x(s.at), y(v)); });
    for (let i = series.length - 1; i >= 0; i--) ctx.lineTo(x(series[i].at), y(below[i]));
    ctx.closePath();
    ctx.fillStyle = bandColour(k);
    ctx.fill();
    if (k) {   // the gap between this band and the one below it
      ctx.beginPath();
      series.forEach((s, i) => ctx[i ? 'lineTo' : 'moveTo'](x(s.at), y(below[i])));
      ctx.strokeStyle = surface;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    series.forEach((s, i) => { below[i] += stacked[i][k]; });
  }

  // The years along the foot, and a mark at every instant something happened.
  const axis = plot.y + plot.h;
  ctx.strokeStyle = rule;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, axis + 0.5);
  ctx.lineTo(plot.x + plot.w, axis + 0.5);
  ctx.stroke();
  ctx.fillStyle = ink3;
  ctx.textAlign = 'center';
  for (const tick of ticksOf(span, Math.max(2, Math.floor(plot.w / 90)))) {
    ctx.fillText(yearLabel(tick.year), x(tick.at), axis + 20);
    ctx.beginPath();
    ctx.moveTo(Math.round(x(tick.at)) + 0.5, axis);
    ctx.lineTo(Math.round(x(tick.at)) + 0.5, axis + 4);
    ctx.stroke();
  }
  for (const e of events) {
    ctx.strokeStyle = e.kind === 'after' ? token('--accent', '#8a2f63') : ink3;
    ctx.lineWidth = e.kind === 'after' ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(e.at)) + 0.5, axis + 1);
    ctx.lineTo(Math.round(x(e.at)) + 0.5, axis + (e.kind === 'after' ? 8 : 6));
    ctx.stroke();
  }

  // Where the pointer is, and where the viewer stands.
  if (hover !== null) {
    ctx.strokeStyle = ink3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(hover)) + 0.5, plot.y);
    ctx.lineTo(Math.round(x(hover)) + 0.5, axis);
    ctx.stroke();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(at), plot.y - 6);
  ctx.lineTo(x(at), axis);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x(at), plot.y - 6, 3.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.textAlign = 'left';
}

// ─── Reading it out ──────────────────────────────────────────────────────────

const yearOf = n => Math.floor(n / YEAR);
const longSpan = () => !span || span.end - span.start > 5 * YEAR;
const readOut = n => (longSpan() ? yearLabel(yearOf(n)) : whenText(n));

function renderHead() {
  const here = countsAt(at);
  const millis = new Set(layered.map(d => d.milli.split('@')[0])).size;
  const deepest = layered.reduce((m, d) => Math.max(m, d.level), 0);
  $('#year').textContent = span ? readOut(at) : 'No periods recorded';
  $('#tally').innerHTML = [
    [plural(here.total, 'demesne'), 'in force'],
    [plural(millis, 'milli'), 'implemented'],
    [deepest ? `${deepest} deep` : 'none', 'nesting'],
  ].map(([n, label]) => `<li><span class="n">${esc(n)}</span> <span>${esc(label)}</span></li>`).join('');
  $('#chart-words').textContent = span ? `${readOut(at)}: ${plural(here.total, 'demesne')} in force.` : '';

  const counts = fold(here.byLevel);
  $('#legend').innerHTML = counts.map((n, k) => (counts.slice(k).some(Boolean) || n
    ? `<li><span class="key" style="background:${esc(bandColour(k))}"></span>
         <span>${k === BANDS - 1 ? `Level ${BANDS} or deeper` : `Level ${k + 1}`}</span><span class="n">${n}</span></li>`
    : '')).join('');
}

const EVENT_WORD = { began: 'began', ended: 'ended', after: 'came after' };

function renderPanel() {
  const near = events.filter(e => Math.abs(e.at - at) <= YEAR).slice(0, 8);
  const rows = layered.map(d => `
    <li style="--depth:${d.depth}">
      <span class="demesne-head">${swatch(cueFor(cues, d.ref))}<strong>${esc(d.name)}</strong></span>
      <span>${d.example ? `${esc(d.milliTitle)} <span class="ref">example</span>`
        : `<a href="./?contract=${encodeURIComponent(d.milli.split('@')[0])}">${esc(d.milliTitle)}</a>`}</span>
      <span class="stack-note">${[d.from ? `from ${esc(d.from)}` : '', d.until ? `until ${esc(d.until)}` : '',
                                  d.after ? `after ${nameOfAny(d.after)}` : ''].filter(Boolean).join(' · ') || 'no period recorded'}</span>
    </li>`).join('');
  const table = all.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.milliTitle)}</td>
    <td class="n">${esc(d.from ?? '')}</td><td class="n">${esc(d.until ?? '')}</td><td>${d.after ? nameOfAny(d.after) : ''}</td></tr>`).join('');

  $('#details').innerHTML = `
    <section>
      <h2>In force at ${esc(span ? readOut(at) : 'any time')}</h2>
      ${layered.length ? `<ol class="stack">${rows}</ol>` : '<p class="empty">No demesne was in force here.</p>'}
    </section>
    ${near.length ? `<section>
      <h2>Within a year of it</h2>
      <ul class="events">${near.map(e => `<li><span class="n">${esc(readOut(e.at))}</span>
        <span>${esc(e.name)} ${EVENT_WORD[e.kind]}${e.kind === 'after' ? ` ${nameOfAny(e.other)}` : ''}</span></li>`).join('')}</ul>
    </section>` : ''}
    <section>
      <h2>Every demesne</h2>
      <details class="table-view"><summary>The periods as a table</summary>
        <table class="data-table">
          <thead><tr><th>Demesne</th><th>Milli</th><th>From</th><th>Until</th><th>After</th></tr></thead>
          <tbody>${table}</tbody>
        </table>
      </details>
      <fieldset class="layers"><legend>Cases</legend>
        ${Object.entries(CASES).map(([id, label]) =>
          `<label><input type="checkbox" data-case="${id}"${state.cases.has(id) ? ' checked' : ''}> ${label}</label>`).join('')}
      </fieldset>
      ${state.space === 'earth' ? `<label class="example-toggle"><input type="checkbox" id="example"${showingExample() ? ' checked' : ''}> Show the example demesnes</label>` : ''}
    </section>`;
}

function renderScrub() {
  const scrub = $('#scrub');
  scrub.disabled = !span;
  if (!span) return;
  scrub.min = span.start;
  scrub.max = span.end;
  scrub.value = at;
  scrub.setAttribute('aria-valuetext', readOut(at));
}

// ─── Drawing it all ──────────────────────────────────────────────────────────

function refresh({ refit = false } = {}) {
  atInstant();
  map?.getSource('demesnes')?.setData(featuresOf(map, layered, cues));
  renderHead();
  renderPanel();
  renderScrub();
  drawChart();
  writeUrl();
  if (refit) fit();
}

// Dragging redraws at most once a frame: the globe, the counts and the lists follow the instant, never the pointer.
function moveTo(n, options) {
  const next = Math.min(Math.max(Math.round(n), span.start), span.end);
  if (next === at) return;
  at = next;
  state.when = whenText(at);
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = null; refresh(options); });
}

function fit() {
  const shown = layered.length ? layered : all;
  if (!shown.length) return map.jumpTo({ center: [-30, 25], zoom: 1.3 });
  const b = shown.map(d => bbox(d.segment))
    .reduce((a, c) => [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 90, maxZoom: 7, duration: 0 });   // with room to see where on the globe
}

function stopPlaying() {
  clearInterval(playing);
  playing = null;
  $('#play').textContent = 'Play';
  $('#play').setAttribute('aria-pressed', 'false');
}

function play() {
  if (playing) return stopPlaying();
  if (!span) return;
  if (at >= span.end) moveTo(span.start);
  $('#play').textContent = 'Pause';
  $('#play').setAttribute('aria-pressed', 'true');
  playing = setInterval(() => {
    if (at >= span.end) return stopPlaying();
    moveTo(at + (span.end - span.start) / STEPS);
  }, 70);
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
  prepare();
  atInstant();
  renderHead();
  renderPanel();
  renderScrub();
  writeUrl();   // the instant it opens at is the instant a link carries
  $('#timeline-note').textContent = span
    ? 'Drag along the strip, or press Play. Each band is a nesting level; a mark below the years is a demesne beginning or ending, and a thicker one is a demesne that came after another.'
    : 'No demesne records a period yet, so there is nothing to lay out in time. The Globe shows them all.';

  map = new maplibregl.Map({ container: 'map', style: styleFor(state.space), center: [-30, 25], zoom: 1.3, attributionControl: { compact: true } });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.on('style.load', () => addDemesneLayers(map, featuresOf(map, layered, cues)));
  map.once('load', fit);

  drawChart();
  addEventListener('resize', drawChart);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(drawChart));

  $('#space').addEventListener('change', e => {
    stopPlaying();
    state.space = e.target.value;
    state.when = null;
    prepare();
    map.setStyle(styleFor(state.space));   // its style.load draws the demesnes again
    refresh({ refit: true });
  });
  $('#scrub').addEventListener('input', e => { stopPlaying(); moveTo(Number(e.target.value)); });
  $('#play').addEventListener('click', play);
  $('#details').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'example') state.example = t.checked;
    else if (t.dataset.case) t.checked ? state.cases.add(t.dataset.case) : state.cases.delete(t.dataset.case);
    else return;
    state.when = null;   // another case may span another time; start from what it records
    prepare();
    refresh({ refit: true });
    $(t.dataset.case ? `[data-case="${t.dataset.case}"]` : `#${t.id}`)?.focus();   // the panel was redrawn; keep keyboard focus
  });

  // The strip is dragged like a scrubber, and hovered like a chart.
  const canvas = $('#chart');
  const plotNow = () => plotOf(canvas.clientWidth, canvas.clientHeight);
  const xIn = e => e.clientX - canvas.getBoundingClientRect().left;
  canvas.addEventListener('pointerdown', e => {
    if (!span) return;
    stopPlaying();
    canvas.setPointerCapture(e.pointerId);
    moveTo(instantAt(xIn(e), plotNow()));
  });
  canvas.addEventListener('pointermove', e => {
    if (!span) return;
    const n = instantAt(xIn(e), plotNow());
    if (canvas.hasPointerCapture(e.pointerId)) return moveTo(n);
    hover = Math.min(Math.max(n, span.start), span.end);
    showTip(e, hover);
    drawChart();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; $('#tip').hidden = true; drawChart(); });
  canvas.addEventListener('pointerup', e => canvas.releasePointerCapture(e.pointerId));
}

// The readout under the pointer: every band at that instant, the value first.
function showTip(e, n) {
  if (!span) return;
  const counts = fold(countsAt(n).byLevel);
  const tip = $('#tip');
  tip.innerHTML = `<p class="tip-when">${esc(readOut(n))}</p>
    <ul>${counts.map((v, k) => (v ? `<li><span class="key" style="background:${esc(bandColour(k))}"></span><span class="n">${v}</span>
      <span>${k === BANDS - 1 ? `level ${BANDS} or deeper` : `level ${k + 1}`}</span></li>` : '')).join('')
      || '<li><span class="n">0</span> <span>in force</span></li>'}</ul>`;
  tip.hidden = false;
  const box = $('.timeline-plot').getBoundingClientRect();
  const x = e.clientX - box.left;
  tip.style.left = `${Math.min(Math.max(x + 12, 4), box.width - tip.offsetWidth - 4)}px`;
}

main();
