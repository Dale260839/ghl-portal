/**
 * Emits the presenter HUD as one self-contained HTML file.
 *
 *   node scripts/build-hud.mjs
 *
 * The script and the screen maps stay in `apps/web/src/app/hud/`, so the file
 * and the `/hud` route are generated from the same source and cannot drift.
 * Rerun this after editing either.
 *
 * Self-contained on purpose: no server, no network, no fonts to fetch. It opens
 * on a laptop with no wifi, on a second machine, or off a USB stick — which is
 * exactly the situation a demo goes wrong in.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { STEPS, SUBTITLE, TITLE } from '../apps/web/src/app/hud/script.ts';
import { SCREENS } from '../apps/web/src/app/hud/wireframes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'docs', 'demo-hud.html');

/** `</script>` inside a data blob would close the tag early. */
function embed(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// The annex is optional, so the time shown on the clock is the walkthrough only.
const WALK = STEPS.filter((s) => s.section !== 'annex');
const PLANNED_SECONDS = WALK.reduce((sum, s) => sum + s.seconds, 0);
const PLANNED = `${Math.floor(PLANNED_SECONDS / 60)}:${String(PLANNED_SECONDS % 60).padStart(2, '0')}`;

const CSS = `
:root {
  --bg: #080d16;
  --panel: #0e1626;
  --panel-2: #0b1220;
  --line: #1e2b41;
  --text: #dbe4f0;
  --muted: #6b7f9e;
  --dim: #445573;
  --blue: #2563eb;
  --blue-text: #60a5fa;
  --amber: #f59e0b;
  --green: #34d399;
  --violet: #a78bfa;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
  font-size: 15px;
  -webkit-font-smoothing: antialiased;
}

.app { display: flex; flex-direction: column; height: 100%; }

/* ── Header ─────────────────────────────────────────────────────────────── */
header {
  display: flex; align-items: center; gap: 16px;
  flex-shrink: 0;
  padding: 10px 20px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--line);
}
header h1 { margin: 0; font-size: 14px; font-weight: 600; color: #fff; }
header p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.spacer { margin-left: auto; }

.clock {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
  font-size: 14px;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
}
.clock.behind { border-color: rgba(245,158,11,.6); background: rgba(245,158,11,.1); color: var(--amber); }
.clock .total { color: var(--dim); font-size: 12px; margin-left: 6px; }

button {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--text);
  padding: 5px 11px;
  font-size: 13px;
  transition: background .12s;
}
button:hover:not(:disabled) { background: #17243a; }
button:disabled { opacity: .3; cursor: default; }
button.primary { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 500; }
button.primary:hover:not(:disabled) { background: #3b82f6; }
button.ghost { border-color: transparent; color: var(--dim); }
button.ghost:hover { color: var(--text); background: transparent; }

/* ── Body ───────────────────────────────────────────────────────────────── */
.body { display: flex; flex: 1; min-height: 0; }

aside {
  width: 320px; flex-shrink: 0;
  display: flex; flex-direction: column;
  border-right: 1px solid var(--line);
  overflow-y: auto;
}

.label {
  font-size: 10px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
  color: var(--muted);
}

.map-wrap { flex-shrink: 0; padding: 14px; border-bottom: 1px solid var(--line); }
.map-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.map-head .screen-name { font-size: 10px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.map {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  /* row count is set per screen from JS */
  gap: 2px;
  aspect-ratio: 15 / 11;
  padding: 4px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 6px;
}
.blk {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
  border-radius: 2px;
  padding: 0 3px;
  background: #16223a;
  opacity: .6;
}
.blk .t {
  font-size: 7px; line-height: 1; color: var(--muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.blk.sidebar, .blk.panel, .blk.hero { background: #131e33; }
.blk.button { background: #22314e; }
.blk.lit {
  background: var(--amber);
  box-shadow: 0 0 0 2px #fcd34d;
  opacity: 1;
  z-index: 2;
  animation: pulse 1.8s ease-in-out infinite;
}
.blk.lit .t { color: #1c1206; font-weight: 600; }
.blk .num {
  position: absolute; top: -4px; left: -4px;
  width: 15px; height: 15px; border-radius: 50%;
  background: #fcd34d; color: #1c1206;
  font-size: 8px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 2px #fcd34d; } 50% { box-shadow: 0 0 0 5px rgba(252,211,77,.3); } }

.route { margin: 8px 0 0; font-family: ui-monospace, Consolas, monospace; font-size: 10px; color: var(--dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

nav { flex: 1; padding: 8px; }
.step-btn {
  display: flex; align-items: flex-start; gap: 8px;
  width: 100%; text-align: left;
  border: none; background: transparent;
  padding: 6px 8px; border-radius: 4px;
  font-size: 12.5px; color: var(--muted);
}
.step-btn:hover { background: #131e33; }
.step-btn .n { width: 16px; flex-shrink: 0; text-align: right; font-family: ui-monospace, Consolas, monospace;
  font-size: 10px; color: var(--dim); }
.step-btn .ttl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-btn.done { color: var(--dim); }
.step-btn.active { background: var(--blue); color: #fff; font-weight: 500; }
.step-btn.active .n { color: #bfdbfe; }
.star { color: rgba(245,158,11,.75); }
.step-btn.active .star { color: #fcd34d; }

/* ── Step detail ────────────────────────────────────────────────────────── */
main { flex: 1; min-width: 0; overflow-y: auto; }
.detail { max-width: 760px; padding: 24px 26px 40px; }
.detail h2 { margin: 4px 0 0; font-size: 27px; font-weight: 600; color: #fff; letter-spacing: -.01em; }
.detail h2 .star { font-size: 19px; vertical-align: super; }
.dur { margin-top: 5px; font-size: 12px; color: var(--muted); }

.box {
  display: flex; gap: 12px;
  margin-top: 16px; padding: 15px 16px;
  background: var(--panel-2);
  border-radius: 6px;
}
.bar { width: 3px; flex-shrink: 0; border-radius: 2px; }
.box .label { margin-bottom: 6px; }
.box p { margin: 0; line-height: 1.6; }
.box.hover .bar { background: var(--green); } .box.hover .label { color: var(--green); }
.box.watch .bar { background: var(--amber); } .box.watch .label { color: var(--amber); }
.box.say   .bar { background: var(--blue); }  .box.say .label   { color: var(--blue-text); }
.box.backend .bar { background: var(--violet); } .box.backend .label { color: var(--violet); }
.box.say p { font-size: 16px; color: #f1f5f9; }
.box.hover p, .box.watch p { font-size: 14px; color: #c3cfe0; }
/* Quieter than Say on purpose — reference material, not the script. */
.box.backend p { font-size: 13.5px; color: #9aa9bf; }

.annex-head {
  margin: 12px 0 4px; padding: 10px 8px 0;
  border-top: 1px solid var(--line);
  font-size: 10px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
  color: var(--dim);
}
.annex-tag { color: var(--violet); }

.asked { margin-top: 16px; padding: 15px 16px; background: var(--panel-2);
  border: 1px solid var(--line); border-radius: 6px; }
.asked dl { margin: 10px 0 0; }
.asked dt { font-size: 14px; font-weight: 500; color: #cbd5e1; }
.asked dd { margin: 3px 0 12px; font-size: 14px; line-height: 1.6; color: var(--muted); }
.asked dd:last-child { margin-bottom: 0; }

.then { margin-top: 18px; padding-top: 13px; border-top: 1px solid var(--line); }
.then p { margin: 5px 0 0; font-size: 14px; font-weight: 500; color: #e2e8f0; }

/* ── Footer ─────────────────────────────────────────────────────────────── */
footer {
  display: flex; align-items: center; gap: 12px;
  flex-shrink: 0;
  padding: 10px 20px;
  background: var(--panel-2);
  border-top: 1px solid var(--line);
}
.next-up { flex: 1; min-width: 0; font-size: 12px; color: var(--dim);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
kbd { border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px;
  font-size: 10px; color: var(--dim); font-family: inherit; }
.by-here { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: var(--dim); }

/* ── Narrow screens ─────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  aside { display: none; }
}

/* ── Paper backup ───────────────────────────────────────────────────────── */
#print { display: none; }
@media print {
  .app { display: none; }
  #print { display: block; color: #000; background: #fff; font-size: 11pt; }
  #print h2 { font-size: 14pt; margin: 18pt 0 2pt; page-break-after: avoid; }
  #print .m { font-size: 9pt; color: #555; margin: 0 0 6pt; }
  #print p { margin: 0 0 5pt; line-height: 1.45; }
  #print .k { font-weight: 700; font-size: 8pt; letter-spacing: .08em; text-transform: uppercase; }
  #print .stp { page-break-inside: avoid; margin-bottom: 12pt; }
  html, body { background: #fff; }
}
`;

const JS = `
const STEPS = __STEPS__;
const SCREENS = __SCREENS__;

// The annex is optional reference material, so it must not inflate the time the
// call is sold as, nor the "step N of M" the presenter is pacing against.
const isWalk = (s) => s.section !== 'annex';
const WALK = STEPS.filter(isWalk).length;
const TOTAL = STEPS.filter(isWalk).reduce((s, x) => s + x.seconds, 0);

let index = 0;
let elapsed = 0;
let running = false;
let ticker = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock = (n) => Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
const human = (n) => n < 60 ? n + ' sec' : (Number.isInteger(n / 60) ? n / 60 + ' min' : (n / 60).toFixed(1) + ' min');
const plannedBy = (i) => STEPS.slice(0, i + 1).filter(isWalk).reduce((s, x) => s + x.seconds, 0);

function drawMap() {
  const step = STEPS[index];
  const screen = SCREENS[step.screen];
  $('screen-name').textContent = screen.name;
  $('route').textContent = screen.route;
  $('map').style.gridTemplateRows = 'repeat(' + (screen.rows || 14) + ', minmax(0, 1fr))';
  $('map').innerHTML = screen.blocks.map((b) => {
    const lit = b.id === step.hotspot;
    const style = 'grid-column:' + b.col[0] + '/span ' + b.col[1] + ';grid-row:' + b.row[0] + '/span ' + b.row[1];
    return '<div class="blk ' + b.kind + (lit ? ' lit' : '') + '" style="' + style + '">'
      + (lit ? '<span class="num">' + index + '</span>' : '')
      + (b.label ? '<span class="t">' + esc(b.label) + '</span>' : '')
      + '</div>';
  }).join('');
}

function drawList() {
  $('steps').innerHTML = STEPS.map((s, i) => {
    const cls = i === index ? 'active' : (i < index ? 'done' : '');
    const head = (!isWalk(s) && isWalk(STEPS[i - 1] || {}))
      ? '<div class="annex-head">Annex &middot; how it works</div>' : '';
    return head + '<button class="step-btn ' + cls + '" data-i="' + i + '">'
      + '<span class="n">' + i + '</span>'
      + '<span class="ttl">' + esc(s.title) + '</span>'
      + (s.star ? '<span class="star">&#9733;</span>' : '')
      + '</button>';
  }).join('');
  // Query the buttons rather than walking children — the annex divider is a
  // sibling and has no step index on it.
  for (const b of $('steps').querySelectorAll('.step-btn')) {
    b.onclick = () => go(Number(b.dataset.i));
  }
}

function box(kind, label, text) {
  return '<div class="box ' + kind + '"><div class="bar"></div><div style="min-width:0">'
    + '<div class="label">' + label + '</div><p>' + esc(text) + '</p></div></div>';
}

function drawDetail() {
  const s = STEPS[index];
  const heading = isWalk(s)
    ? 'Step ' + index + ' of ' + (WALK - 1)
    : '<span class="annex-tag">Annex &middot; not part of the walkthrough</span>';
  let html = '<div class="label">' + heading + '</div>'
    + '<h2>' + esc(s.title) + (s.star ? ' <span class="star">&#9733;</span>' : '') + '</h2>'
    + '<div class="dur">~' + human(s.seconds) + '</div>'
    + box('hover', 'Put the mouse here', s.hover);
  if (s.watch) html += box('watch', 'Watch out', s.watch);
  html += box('say', 'Say', s.say);
  if (s.backend) html += box('backend', 'Under the hood &mdash; only if asked', s.backend);
  if (s.ifAsked) {
    html += '<div class="asked"><div class="label">If they ask</div><dl>'
      + s.ifAsked.map((qa) => '<dt>' + esc(qa.q) + '</dt><dd>' + esc(qa.a) + '</dd>').join('')
      + '</dl></div>';
  }
  html += '<div class="then"><div class="label">Then</div><p>' + esc(s.then) + '</p></div>';
  $('detail').innerHTML = html;
  $('detail').parentElement.scrollTop = 0;
}

function drawFooter() {
  const next = STEPS[index + 1];
  $('next-up').textContent = next ? 'Next: ' + next.title : 'End of the walkthrough';
  $('by-here').textContent = 'by here: ' + clock(plannedBy(index));
  $('prev').disabled = index === 0;
  $('next').disabled = index === STEPS.length - 1;
}

function drawClock() {
  $('elapsed').textContent = clock(elapsed);
  $('clock').classList.toggle('behind', running && elapsed > plannedBy(index) + 60);
  $('toggle').textContent = running ? 'Pause' : 'Start';
}

function render() {
  drawMap(); drawList(); drawDetail(); drawFooter(); drawClock();
}

function go(n) {
  index = Math.max(0, Math.min(STEPS.length - 1, n));
  location.hash = String(index);
  render();
}

$('prev').onclick = () => go(index - 1);
$('next').onclick = () => go(index + 1);
$('toggle').onclick = () => {
  running = !running;
  clearInterval(ticker);
  if (running) ticker = setInterval(() => { elapsed++; drawClock(); }, 1000);
  drawClock();
};
$('reset').onclick = () => { running = false; clearInterval(ticker); elapsed = 0; drawClock(); };
$('print').onclick = () => window.print();

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(index + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(index - 1); }
  else if (e.key.toLowerCase() === 't') { $('toggle').click(); }
});

// Paper backup — every step, linear, only visible when printing.
$('print-body').innerHTML = '<h1>' + esc(__TITLE__) + '</h1>' + STEPS.map((s, i) =>
  '<div class="stp"><h2>' + i + '. ' + esc(s.title) + (s.star ? ' \\u2605' : '') + '</h2>'
  + '<p class="m">~' + human(s.seconds) + ' &middot; ' + esc(SCREENS[s.screen].name) + '</p>'
  + '<p><span class="k">Hover</span> ' + esc(s.hover) + '</p>'
  + (s.watch ? '<p><span class="k">Watch</span> ' + esc(s.watch) + '</p>' : '')
  + '<p><span class="k">Say</span> ' + esc(s.say) + '</p>'
  + (s.backend ? '<p><span class="k">Under the hood</span> ' + esc(s.backend) + '</p>' : '')
  + (s.ifAsked ? s.ifAsked.map((qa) => '<p><span class="k">If asked</span> ' + esc(qa.q) + ' &mdash; ' + esc(qa.a) + '</p>').join('') : '')
  + '<p><span class="k">Then</span> ' + esc(s.then) + '</p></div>').join('');

const fromHash = parseInt(location.hash.replace('#', ''), 10);
if (Number.isInteger(fromHash)) index = Math.max(0, Math.min(STEPS.length - 1, fromHash));
render();
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${TITLE} — Demo HUD</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <header>
    <div style="min-width:0">
      <h1>${TITLE}</h1>
      <p>${SUBTITLE}</p>
    </div>
    <div class="spacer"></div>
    <div class="clock" id="clock"><span id="elapsed">0:00</span><span class="total">/ ${PLANNED}</span></div>
    <button id="toggle">Start</button>
    <button class="ghost" id="reset">Reset</button>
    <button class="ghost" id="print">Print</button>
  </header>

  <div class="body">
    <aside>
      <div class="map-wrap">
        <div class="map-head">
          <span class="label">Where to hover</span>
          <span class="screen-name" id="screen-name"></span>
        </div>
        <div class="map" id="map"></div>
        <p class="route" id="route"></p>
      </div>
      <nav id="steps"></nav>
    </aside>

    <main><div class="detail" id="detail"></div></main>
  </div>

  <footer>
    <button id="prev">&larr; Prev</button>
    <button class="primary" id="next">Next &rarr;</button>
    <div class="next-up" id="next-up"></div>
    <div class="by-here" id="by-here"></div>
    <kbd>&larr; &rarr; to move &middot; T to time</kbd>
  </footer>
</div>

<div id="print"><div id="print-body"></div></div>

<script>
${JS.replace('__STEPS__', embed(STEPS))
  .replace('__SCREENS__', embed(SCREENS))
  .replace('__TITLE__', embed(TITLE))}
</script>
</body>
</html>
`;

writeFileSync(OUT, html, 'utf8');
console.log(`wrote ${OUT} — ${STEPS.length} steps, ${(html.length / 1024).toFixed(1)} kB`);
