/**
 * Emits the presenter HUD as one self-contained HTML file.
 *
 *   node scripts/build-hud.mjs        (or: npm run hud)
 *
 * Self-contained on purpose: no server, no network, no fonts to fetch. It opens
 * on a laptop with no wifi, on a second machine, or off a USB stick — which is
 * exactly the situation a demo goes wrong in.
 *
 * The words live in `apps/web/src/lib/hud/script.ts`; the screen maps in
 * `wireframes.ts`, which is scraped from the running app by
 * `build-wireframes.mjs` rather than drawn by hand. This file only renders them.
 *
 * The System View draws a rough copy of the real screen — sidebar, headings,
 * buttons, in their real order — rather than abstract boxes. A presenter
 * glancing at a second monitor recognises a shape far faster than a legend, and
 * every label in it came out of the actual HTML.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { STEPS, SUBTITLE, TITLE } from '../apps/web/src/lib/hud/script.ts';
import { SCREENS } from '../apps/web/src/lib/hud/wireframes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'docs', 'demo-hud.html');

/** `</script>` inside a data blob would close the tag early. */
function embed(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const WALK = STEPS.filter((s) => s.section !== 'annex');
const PLANNED = WALK.reduce((sum, s) => sum + s.seconds, 0);
const PLANNED_LABEL = `${Math.floor(PLANNED / 60)}:${String(PLANNED % 60).padStart(2, '0')}`;

const CSS = `
:root{
  --ink:#080c13; --panel:#111722; --raise:#161d2b; --raise2:#1c2434;
  --line:#232c3c; --line2:#303b4e;
  --tx:#e9edf5; --mut:#93a0b6; --faint:#5f6b81;
  --accent:#4fd6c9; --accent-dim:#173735;
  --signal:#ffb454; --signal-dim:#3a2c14;
  --warn:#ff6b6b; --warn-dim:#331a1c;
  --good:#5bd88a;
  --sig-glow:0 0 0 2px var(--signal), 0 0 22px -2px rgba(255,180,84,.55);
  --sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
  --mono:ui-monospace,"Cascadia Code",Consolas,monospace;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--ink);color:var(--tx);font-family:var(--sans);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.mono{font-family:var(--mono)}

/* ── topbar ── */
.topbar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:16px;padding:9px 18px;
  background:linear-gradient(180deg,#0d121b,#080c13);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.02em;white-space:nowrap}
.brand .dot{width:9px;height:9px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.privacy{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;letter-spacing:.08em;
  text-transform:uppercase;color:var(--signal);background:var(--signal-dim);border:1px solid #4d3a1a;
  padding:5px 10px;border-radius:6px;white-space:nowrap}
.privacy svg{width:13px;height:13px;stroke:var(--signal);fill:none;stroke-width:2}
.spacer{flex:1}
.progresswrap{display:flex;align-items:center;gap:12px}
.progresswrap .count{font-family:var(--mono);font-size:12px;color:var(--mut)}
.pbar{width:140px;height:5px;border-radius:3px;background:var(--raise2);overflow:hidden}
.pbar>i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#7be7dd);transition:width .2s}
.clock{font-family:var(--mono);font-size:12px;color:var(--mut);border:1px solid var(--line);
  padding:5px 9px;border-radius:7px;background:var(--panel);cursor:pointer;user-select:none}
.clock.behind{border-color:rgba(255,180,84,.6);background:var(--signal-dim);color:var(--signal)}
.clock b{color:var(--tx)}
.modes{display:flex;background:var(--raise);border:1px solid var(--line);border-radius:8px;padding:3px}
.modes button{font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--mut);background:none;border:0;padding:6px 11px;border-radius:6px;cursor:pointer}
.modes button.on{background:var(--accent);color:#04231f;font-weight:600}

/* ── shell ── */
.shell{display:grid;grid-template-columns:270px 1fr;min-height:calc(100vh - 47px)}
.side{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0}
.side .head{padding:14px 16px 10px;border-bottom:1px solid var(--line)}
.side .head .t{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.seq{flex:1;overflow-y:auto;padding:8px 9px}
.seqgroup{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);
  padding:12px 9px 5px;border-top:1px solid var(--line);margin-top:8px}
.seqgroup:first-child{border-top:0;margin-top:0}
.step{display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:9px;width:100%;text-align:left;
  cursor:pointer;padding:8px 9px;border-radius:8px;border:1px solid transparent;background:none;color:var(--mut);
  font-family:inherit;font-size:13.5px;margin-bottom:2px}
.step:hover{background:var(--raise);color:var(--tx)}
.step .num{font-family:var(--mono);font-size:11px;color:var(--faint);text-align:right}
.step .lbl{line-height:1.25}
.step.active{background:var(--accent-dim);border-color:#2f5c58;color:var(--tx)}
.step.active .num{color:var(--accent)}
.step.done .num{color:var(--good)}
.step .flag svg{width:15px;height:15px;stroke:var(--warn);fill:none;stroke-width:2;display:block}
.step .star{color:var(--signal)}
.navfoot{border-top:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:9px}
.navbtns{display:flex;gap:8px}
.navbtns button{flex:1;font-family:var(--mono);font-size:12px;letter-spacing:.05em;padding:9px;border-radius:8px;
  border:1px solid var(--line2);background:var(--raise);color:var(--tx);cursor:pointer;text-transform:uppercase}
.navbtns button:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.navbtns button:disabled{opacity:.35;cursor:default}
.nextup{font-size:12px;color:var(--faint)}
.nextup b{color:var(--mut);font-weight:500}

/* ── main ── */
.main{min-width:0;padding:22px 26px 60px;max-width:1120px}
.stephead{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:4px}
.stephead .of{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:var(--accent);text-transform:uppercase}
h1.title{font-size:27px;line-height:1.15;margin:4px 0 0;font-weight:700;letter-spacing:-.01em}
.time{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--mut);white-space:nowrap;
  border:1px solid var(--line);padding:5px 10px;border-radius:7px;background:var(--panel)}
.time b{color:var(--tx)}

.primary{display:flex;gap:10px;align-items:baseline;margin:14px 0 16px;padding:12px 15px;background:var(--raise);
  border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:0 9px 9px 0}
.primary .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent);white-space:nowrap}
.primary .v{font-size:15px;color:var(--tx);font-weight:500}

.sec{margin-top:18px}
.sec>.label{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.sec>.label .tag{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.sec>.label .rule{flex:1;height:1px;background:var(--line)}
.view-tag .tag{color:var(--accent)}

/* ── system view ── */
.viewport{position:relative;background:#0b0f16;border:1px solid var(--line2);border-radius:12px;overflow:hidden;
  box-shadow:0 12px 40px -12px rgba(0,0,0,.7)}
.vchrome{display:flex;align-items:center;gap:7px;padding:8px 12px;background:#090d14;border-bottom:1px solid var(--line)}
.vchrome .tl{display:flex;gap:6px}
.vchrome .tl i{width:10px;height:10px;border-radius:50%;background:#2a3240}
.vchrome .url{font-family:var(--mono);font-size:11px;color:var(--mut);background:#10151e;border:1px solid var(--line);
  border-radius:6px;padding:4px 10px;margin-left:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app{display:grid;grid-template-columns:158px 1fr;min-height:300px}
.app.nosidebar{grid-template-columns:1fr}
.aside{background:#0a0e15;border-right:1px solid var(--line);padding:11px 8px;display:flex;flex-direction:column;gap:2px}
.abrand{font-weight:700;font-size:14px;padding:2px 8px 9px;letter-spacing:.02em}
.abrand span{color:var(--accent)}
.anav{font-size:11px;color:var(--mut);padding:5px 9px;border-radius:6px;display:flex;align-items:center;gap:7px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.anav .b{width:6px;height:6px;border-radius:2px;background:#3a4557;flex:none}
.anav.on{background:var(--accent-dim);color:var(--tx)}
.anav.on .b{background:var(--accent)}
.abody{padding:15px;min-width:0;background:#0d121b;background-image:radial-gradient(circle at 92% -12%,#141b27,transparent 55%)}
.atitle{font-size:15px;font-weight:600;margin-bottom:11px}
.acards{display:grid;gap:9px;margin-bottom:10px}
.acard{background:#101724;border:1px solid var(--line);border-radius:9px;padding:11px 12px;min-height:44px}
.acard .cl{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
.acard .cv{font-size:12px;margin-top:5px;color:var(--tx)}
.abtns{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
.abtn{font-size:10.5px;padding:6px 11px;border-radius:7px;border:1px solid var(--line2);background:#1a2231;color:var(--mut)}

/* highlight + avoid */
.hl{position:relative;box-shadow:var(--sig-glow);outline:1px solid var(--signal);z-index:2}
.hl::after{content:attr(data-tip);position:absolute;top:-11px;left:-8px;z-index:3;font-family:var(--mono);
  font-size:10px;font-weight:600;color:#3a2400;background:var(--signal);padding:2px 8px;border-radius:20px;
  white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.5)}
.avoid{position:relative;opacity:.55;filter:grayscale(.4)}
.avoid::after{content:"AVOID";position:absolute;top:-9px;right:-6px;z-index:3;font-family:var(--mono);font-size:9px;
  font-weight:600;color:#fff;background:var(--warn);padding:2px 7px;border-radius:20px}

.route{display:inline-flex;align-items:center;gap:8px;margin-top:11px;font-family:var(--mono);font-size:12px}
.route .rk{color:var(--faint);letter-spacing:.1em;text-transform:uppercase;font-size:10px}
.route .rv{color:var(--accent);background:var(--accent-dim);padding:3px 9px;border-radius:6px}

/* ── mouse / say / watch ── */
.mouse{display:flex;gap:11px;align-items:flex-start;padding:13px 15px;background:var(--raise);
  border:1px solid var(--line);border-radius:10px;margin-top:16px}
.mouse .ico{flex:none;width:30px;height:30px;border-radius:8px;background:var(--signal-dim);border:1px solid #4d3a1a;
  display:grid;place-items:center}
.mouse .ico svg{width:16px;height:16px;stroke:var(--signal);fill:none;stroke-width:2}
.mouse .mh{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--signal);margin-bottom:3px}
.mouse p{margin:0;font-size:15px}

.say{margin-top:16px;background:linear-gradient(180deg,#121a18,#0e1413);border:1px solid #24463f;border-radius:12px;padding:18px 20px}
.say .sl{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.say .sl .tag{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
.say .sl .rule{flex:1;height:1px;background:#24463f}
.say p{margin:0;font-size:20px;line-height:1.5;color:#eef6f3}

.watch{margin-top:16px;background:var(--warn-dim);border:1px solid #52282b;border-left:3px solid var(--warn);
  border-radius:0 10px 10px 0;padding:13px 16px}
.watch .wl{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:11px;letter-spacing:.14em;
  text-transform:uppercase;color:var(--warn);margin-bottom:8px}
.watch .wl svg{width:15px;height:15px;stroke:var(--warn);fill:none;stroke-width:2}
.watch ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px}
.watch li{font-size:14.5px;color:#ffdcdc}

details.hood{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
details.hood>summary{list-style:none;cursor:pointer;padding:13px 15px;display:flex;align-items:center;gap:9px}
details.hood>summary::-webkit-details-marker{display:none}
details.hood>summary .tag{font-family:var(--mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--mut)}
details.hood>summary .hint{margin-left:auto;font-size:11px;color:var(--faint)}
details.hood[open]>summary{border-bottom:1px solid var(--line)}
.hoodbody{padding:13px 15px;display:flex;flex-direction:column;gap:11px}
.hoodbody .q{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:3px}
.hoodbody .simple .q{color:var(--accent)}
.hoodbody .a{font-size:14px;color:var(--tx)}

.ask{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 15px}
.ask .qitem{padding:9px 0;border-top:1px dashed var(--line)}
.ask .qitem:first-of-type{border-top:0;padding-top:0}
.ask .qq{font-size:14px;font-weight:600;margin-bottom:4px;display:flex;gap:7px}
.ask .qq .m{color:var(--signal);font-family:var(--mono)}
.ask .qa{font-size:14px;color:var(--mut)}

.then{margin-top:16px;display:flex;gap:11px;align-items:center;padding:13px 16px;background:var(--accent-dim);
  border:1px solid #2f5c58;border-radius:10px}
.then .ico{flex:none;width:28px;height:28px;border-radius:8px;background:#0c2624;display:grid;place-items:center}
.then .ico svg{width:16px;height:16px;stroke:var(--accent);fill:none;stroke-width:2}
.then .tl{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);margin-bottom:2px}
.then p{margin:0;font-size:15px}

/* ── presenter mode ── */
body.presenter .side,
body.presenter .primary,
body.presenter .sec.hoodsec,
body.presenter .sec.asksec,
body.presenter .time,
body.presenter .sec.view-tag>.label{display:none}
body.presenter .shell{grid-template-columns:1fr}
body.presenter .main{max-width:none;padding:26px 44px}
body.presenter .say p{font-size:27px;line-height:1.45}
body.presenter .mouse p{font-size:19px}
body.presenter .watch li{font-size:17px}
body.presenter h1.title{font-size:33px}
body.presenter .viewport{max-width:720px}

::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:#222a38;border-radius:6px;border:2px solid var(--panel)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media (max-width:900px){.shell{grid-template-columns:1fr}.side{display:none}.app{grid-template-columns:1fr}.aside{display:none}}

/* ── paper backup ── */
#print{display:none}
@media print{
  .topbar,.shell{display:none}
  #print{display:block;color:#000;background:#fff;font-size:11pt}
  #print h2{font-size:13pt;margin:16pt 0 2pt;page-break-after:avoid}
  #print .m{font-size:9pt;color:#555;margin:0 0 5pt}
  #print p{margin:0 0 5pt;line-height:1.45}
  #print .k{font-weight:700;font-size:8pt;letter-spacing:.08em;text-transform:uppercase}
  #print .stp{page-break-inside:avoid;margin-bottom:11pt}
  html,body{background:#fff}
}
`;

const JS = `
const STEPS = __STEPS__;
const SCREENS = __SCREENS__;
const TITLE = __TITLE__;
const WALK = STEPS.filter(s => s.section !== 'annex');
const PLANNED = WALK.reduce((a,s) => a + s.seconds, 0);

let cur = 0, mode = 'full', elapsed = 0, running = false, ticker = null;
const done = new Set();

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock = n => Math.floor(n/60) + ':' + String(n%60).padStart(2,'0');
const human = n => n < 60 ? n + ' sec' : (Number.isInteger(n/60) ? n/60 + ' min' : (n/60).toFixed(1) + ' min');
const walkIndex = i => STEPS.slice(0, i+1).filter(s => s.section !== 'annex').length;
const plannedBy = i => STEPS.slice(0, i+1).filter(s => s.section !== 'annex').reduce((a,s) => a + s.seconds, 0);

const I = {
  warn:'<svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  mouse:'<svg viewBox="0 0 24 24"><path d="M5 3l14 7-6 2-2 6z"/></svg>',
  then:'<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
};

/* ── sequence ── */
function seqHTML(){
  let html = '', lastSection = null;
  STEPS.forEach((s,i) => {
    const section = s.section === 'annex' ? 'annex' : 'walk';
    if (section !== lastSection) {
      html += '<div class="seqgroup">' + (section === 'annex' ? 'Annex \\u00b7 only if asked' : 'Walkthrough') + '</div>';
      lastSection = section;
    }
    const cls = ['step'];
    if (i === cur) cls.push('active');
    else if (done.has(i)) cls.push('done');
    const num = s.section === 'annex' ? 'A' + (STEPS.slice(0,i+1).filter(x=>x.section==='annex').length)
                                      : String(walkIndex(i)).padStart(2,'0');
    const flag = s.risk ? '<span class="flag">' + I.warn + '</span>'
               : s.star ? '<span class="star">\\u2605</span>' : '<span></span>';
    html += '<button class="' + cls.join(' ') + '" data-i="' + i + '">' +
            '<span class="num">' + num + '</span>' +
            '<span class="lbl">' + esc(s.title) + '</span>' + flag + '</button>';
  });
  return html;
}

/* ── the mini app ── */
function appHTML(step){
  const screen = SCREENS[step.screen];
  const blocks = screen.blocks;
  const avoid = new Set(step.avoid || []);
  const mark = b => (b.id === step.hotspot ? ' hl' : (avoid.has(b.id) ? ' avoid' : ''));
  const tip = b => (b.id === step.hotspot ? ' data-tip="point here"' : '');

  const nav = blocks.filter(b => b.kind === 'nav');
  const title = blocks.find(b => b.id === 'title');
  const panels = blocks.filter(b => b.kind === 'panel' || b.kind === 'row' || b.kind === 'tile' || b.kind === 'hero');
  const btns = blocks.filter(b => b.kind === 'button' && b.id !== 'switcher');
  const switcher = blocks.find(b => b.id === 'switcher');

  let side = '';
  if (nav.length) {
    side = '<div class="aside"><div class="abrand">Build<span>Suite</span></div>' +
      nav.map(b => '<div class="anav' + mark(b) + '"' + tip(b) + '><span class="b"></span>' + esc(b.label || '') + '</div>').join('') +
      '</div>';
  }

  let body = '';
  if (switcher) {
    body += '<div style="display:flex;justify-content:flex-end;margin-bottom:9px">' +
            '<span class="abtn' + mark(switcher) + '"' + tip(switcher) + '>' + esc(switcher.label) + ' \\u25be</span></div>';
  }
  if (title) body += '<div class="atitle' + mark(title) + '"' + tip(title) + '>' + esc(title.label || '') + '</div>';
  if (panels.length) {
    const cols = panels.length >= 4 ? 2 : 1;
    body += '<div class="acards" style="grid-template-columns:repeat(' + cols + ',1fr)">' +
      panels.map(b => '<div class="acard' + mark(b) + '"' + tip(b) + '>' +
        '<div class="cl">' + esc((b.label || 'section').slice(0,34)) + '</div>' +
        '<div class="cv">\\u2014</div></div>').join('') + '</div>';
  }
  if (btns.length) {
    body += '<div class="abtns">' + btns.map(b =>
      '<span class="abtn' + mark(b) + '"' + tip(b) + '>' + esc(b.label || '') + '</span>').join('') + '</div>';
  }

  return '<div class="app' + (nav.length ? '' : ' nosidebar') + '">' + side +
         '<div class="abody">' + body + '</div></div>';
}

/* ── main panel ── */
function mainHTML(){
  const s = STEPS[cur];
  const screen = SCREENS[s.screen];
  const isAnnex = s.section === 'annex';
  let h = '';

  h += '<div class="stephead"><div><div class="of">' +
       (isAnnex ? 'Annex \\u00b7 only if asked' : 'Step ' + walkIndex(cur) + ' of ' + WALK.length) +
       (s.risk ? ' \\u00b7 handle with care' : '') + '</div>' +
       '<h1 class="title">' + esc(s.title) + (s.star ? ' <span class="star">\\u2605</span>' : '') + '</h1></div>' +
       '<div class="time">\\u23f1 <b>' + human(s.seconds) + '</b></div></div>';

  h += '<div class="primary"><span class="k">Primary message</span><span class="v">' + esc(s.primary) + '</span></div>';

  h += '<div class="sec view-tag"><div class="label"><span class="tag">System view \\u2014 what to show</span><span class="rule"></span></div>' +
       '<div class="viewport"><div class="vchrome"><span class="tl"><i></i><i></i><i></i></span>' +
       '<span class="url">' + esc(screen.route) + '</span></div>' + appHTML(s) + '</div>' +
       '<div class="route"><span class="rk">Screen</span><span class="rv">' + esc(screen.name) + '</span></div></div>';

  h += '<div class="mouse"><div class="ico">' + I.mouse + '</div><div><div class="mh">Put the mouse here</div>' +
       '<p>' + esc(s.hover) + '</p></div></div>';

  h += '<div class="say"><div class="sl"><span class="tag">Say</span><span class="rule"></span></div>' +
       '<p>' + esc(s.say) + '</p></div>';

  if (s.watch) {
    const items = s.watch.split('\\n\\n').filter(Boolean);
    h += '<div class="watch"><div class="wl">' + I.warn + ' Watch out</div><ul>' +
         items.map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>';
  }

  if (s.hoodSimple || s.backend) {
    h += '<div class="sec hoodsec"><details class="hood"><summary>' +
      '<span class="tag">Under the hood \\u2014 only if asked</span><span class="hint">click to open</span></summary>' +
      '<div class="hoodbody">' +
      (s.hoodSimple ? '<div class="simple"><div class="q">Simple answer</div><div class="a">' + esc(s.hoodSimple) + '</div></div>' : '') +
      (s.backend ? '<div><div class="q">Technical answer</div><div class="a">' + esc(s.backend) + '</div></div>' : '') +
      '</div></details></div>';
  }

  if (s.ifAsked && s.ifAsked.length) {
    h += '<div class="sec asksec"><div class="ask"><div class="label" style="margin-bottom:10px">' +
      '<span class="tag">If they ask</span><span class="rule"></span></div>' +
      s.ifAsked.map(a => '<div class="qitem"><div class="qq"><span class="m">Q</span>' + esc(a.q) + '</div>' +
        '<div class="qa">' + esc(a.a) + '</div></div>').join('') + '</div></div>';
  }

  h += '<div class="then"><div class="ico">' + I.then + '</div><div><div class="tl">Then</div>' +
       '<p>' + esc(s.then) + '</p></div></div>';

  return h;
}

function render(){
  $('seq').innerHTML = seqHTML();
  for (const b of $('seq').querySelectorAll('.step')) b.onclick = () => jump(Number(b.dataset.i));
  $('main').innerHTML = mainHTML();
  const w = walkIndex(cur), isAnnex = STEPS[cur].section === 'annex';
  $('count').textContent = isAnnex ? 'annex' : String(w).padStart(2,'0') + ' / ' + WALK.length;
  $('pbar').style.width = ((isAnnex ? WALK.length : w) / WALK.length * 100) + '%';
  $('prev').disabled = cur === 0;
  $('next').disabled = cur === STEPS.length - 1;
  const nxt = STEPS[cur+1];
  $('nextup').innerHTML = nxt ? 'Next up \\u00b7 <b>' + esc(nxt.title) + '</b>' : 'Final step';
  drawClock();
  window.scrollTo(0,0);
}
function drawClock(){
  const behind = running && elapsed > plannedBy(cur) + 60;
  $('clock').className = 'clock' + (behind ? ' behind' : '');
  $('clock').innerHTML = '\\u23f1 <b>' + clock(elapsed) + '</b> / ' + clock(PLANNED);
}
function jump(i){ done.add(cur); cur = Math.max(0, Math.min(STEPS.length-1, i)); location.hash = String(cur); render(); }
function go(d){ jump(cur + d); }
function setMode(m){
  mode = m;
  document.body.classList.toggle('presenter', m === 'presenter');
  $('mFull').classList.toggle('on', m === 'full');
  $('mPres').classList.toggle('on', m === 'presenter');
}
$('prev').onclick = () => go(-1);
$('next').onclick = () => go(1);
$('mFull').onclick = () => setMode('full');
$('mPres').onclick = () => setMode('presenter');
$('clock').onclick = () => {
  running = !running;
  clearInterval(ticker);
  if (running) ticker = setInterval(() => { elapsed++; drawClock(); }, 1000);
  drawClock();
};
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  else if (e.key.toLowerCase() === 'p') setMode(mode === 'full' ? 'presenter' : 'full');
  else if (e.key.toLowerCase() === 't') $('clock').click();
});

/* paper backup */
$('print-body').innerHTML = '<h1>' + esc(TITLE) + '</h1>' + STEPS.map((s,i) =>
  '<div class="stp"><h2>' + (s.section === 'annex' ? 'Annex' : walkIndex(i)) + '. ' + esc(s.title) + (s.star ? ' \\u2605' : '') + '</h2>' +
  '<p class="m">' + human(s.seconds) + ' \\u00b7 ' + esc(SCREENS[s.screen].name) + '</p>' +
  '<p><span class="k">Primary</span> ' + esc(s.primary) + '</p>' +
  '<p><span class="k">Hover</span> ' + esc(s.hover) + '</p>' +
  (s.watch ? '<p><span class="k">Watch</span> ' + esc(s.watch.replace(/\\n\\n/g,' ')) + '</p>' : '') +
  '<p><span class="k">Say</span> ' + esc(s.say) + '</p>' +
  (s.ifAsked ? s.ifAsked.map(a => '<p><span class="k">If asked</span> ' + esc(a.q) + ' \\u2014 ' + esc(a.a) + '</p>').join('') : '') +
  '<p><span class="k">Then</span> ' + esc(s.then) + '</p></div>').join('');

const fromHash = parseInt(location.hash.replace('#',''), 10);
if (Number.isInteger(fromHash)) cur = Math.max(0, Math.min(STEPS.length-1, fromHash));
render();
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${TITLE} — Presenter HUD</title>
<style>${CSS}</style>
</head>
<body>

<div class="topbar">
  <div class="brand"><span class="dot"></span>${TITLE.toUpperCase()} · PRESENTER HUD</div>
  <div class="privacy">
    <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    Second screen only — your private guide
  </div>
  <div class="spacer"></div>
  <div class="progresswrap">
    <span class="count" id="count">01 / ${WALK.length}</span>
    <span class="pbar"><i id="pbar" style="width:4%"></i></span>
  </div>
  <div class="clock" id="clock" title="Click or press T to start the clock">⏱ <b>0:00</b> / ${PLANNED_LABEL}</div>
  <div class="modes">
    <button id="mFull" class="on">Full Guide</button>
    <button id="mPres">Presenter</button>
  </div>
</div>

<div class="shell">
  <nav class="side">
    <div class="head"><div class="t">Walkthrough sequence</div></div>
    <div class="seq" id="seq"></div>
    <div class="navfoot">
      <div class="navbtns">
        <button id="prev">← Prev</button>
        <button id="next">Next →</button>
      </div>
      <div class="nextup" id="nextup"></div>
    </div>
  </nav>
  <main class="main" id="main"></main>
</div>

<div id="print"><div id="print-body"></div></div>

<script>
${JS.replace('__STEPS__', embed(STEPS)).replace('__SCREENS__', embed(SCREENS)).replace('__TITLE__', embed(TITLE))}
</script>
</body>
</html>
`;

writeFileSync(OUT, html, 'utf8');
console.log(
  `wrote ${OUT} — ${WALK.length} walkthrough steps + ${STEPS.length - WALK.length} annex, ${(
    html.length / 1024
  ).toFixed(1)} kB`,
);
