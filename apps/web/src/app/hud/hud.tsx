'use client';

import { useCallback, useEffect, useState } from 'react';

import { STEPS, SUBTITLE, TITLE, walkthroughSteps, type Step } from './script.ts';
import { SCREENS, type Block } from './wireframes.ts';

/**
 * Presenter HUD — runs on the second monitor while the walkthrough is shared.
 *
 * Dark on purpose. It is the one window that must never be mistaken for the
 * product if it is caught on a share by accident, and it sits beside a bright
 * screen for half an hour.
 *
 * The map is the reason this exists rather than a printed script: knowing what
 * to say is easy, and knowing where the mouse goes next — while talking, on
 * someone else's screen — is not.
 */

/** The annex is optional, so it must not inflate the time the call is sold as. */
const WALKTHROUGH_COUNT = walkthroughSteps().length;
const TOTAL_SECONDS = walkthroughSteps().reduce((sum, step) => sum + step.seconds, 0);

function plannedBy(index: number): number {
  return STEPS.slice(0, index + 1)
    .filter((s) => s.section !== 'annex')
    .reduce((sum, s) => sum + s.seconds, 0);
}

export function Hud() {
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);

  const step = STEPS[index]!;

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(STEPS.length - 1, next)));
  }, []);

  // Restore position from the hash, so a stray refresh mid-call is survivable.
  useEffect(() => {
    const fromHash = Number.parseInt(window.location.hash.replace('#', ''), 10);
    if (Number.isInteger(fromHash)) setIndex(Math.max(0, Math.min(STEPS.length - 1, fromHash)));
  }, []);

  useEffect(() => {
    window.history.replaceState(null, '', `#${index}`);
  }, [index]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault();
        go(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        go(index - 1);
      } else if (event.key.toLowerCase() === 't') {
        setRunning((r) => !r);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, go]);

  // Planned time up to and including this step — the only number that tells the
  // presenter whether they are behind while there is still time to fix it.
  const plannedSoFar = plannedBy(index);
  const behind = running && elapsed > plannedSoFar + 60;

  return (
    <div className="flex h-dvh flex-col bg-[#080d16] text-slate-200">
      <Header
        elapsed={elapsed}
        running={running}
        behind={behind}
        onToggle={() => setRunning((r) => !r)}
        onReset={() => {
          setElapsed(0);
          setRunning(false);
        }}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-r border-slate-800 xl:flex">
          <Map step={step} index={index} />
          <StepList index={index} onPick={go} />
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <StepDetail step={step} index={index} />
        </main>
      </div>

      <Footer index={index} onGo={go} plannedSoFar={plannedSoFar} />
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header({
  elapsed,
  running,
  behind,
  onToggle,
  onReset,
}: {
  elapsed: number;
  running: boolean;
  behind: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-[#0b1220] px-5 py-3">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold text-white">{TITLE}</h1>
        <p className="truncate text-xs text-slate-500">{SUBTITLE}</p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <div
          className={`rounded-md border px-2.5 py-1 font-mono text-sm tabular-nums ${
            behind
              ? 'border-amber-500/60 bg-amber-500/10 text-amber-400'
              : 'border-slate-700 text-slate-300'
          }`}
          title={behind ? 'Running over the planned time' : 'Elapsed'}
        >
          {clock(elapsed)}
          <span className="ml-1.5 text-xs text-slate-600">/ {clock(TOTAL_SECONDS)}</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-slate-800"
        >
          {running ? 'Pause' : 'Start'}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-md px-2 py-1 text-xs text-slate-600 transition hover:text-slate-300"
        >
          Reset
        </button>
      </div>
    </header>
  );
}

// ── The map ──────────────────────────────────────────────────────────────────

const BLOCK_STYLES: Record<Block['kind'], string> = {
  sidebar: 'bg-slate-800/40',
  nav: 'bg-slate-800/70',
  header: 'bg-slate-800/50',
  tile: 'bg-slate-800/60',
  panel: 'bg-slate-800/40',
  row: 'bg-slate-800/55',
  button: 'bg-slate-700/70',
  hero: 'bg-slate-800/30',
};

function Map({ step, index }: { step: Step; index: number }) {
  const screen = SCREENS[step.screen];

  return (
    <div className="shrink-0 border-b border-slate-800 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
          Where to hover
        </h2>
        <span className="truncate text-[10px] text-slate-600">{screen.name}</span>
      </div>

      <div
        className="grid aspect-[15/11] w-full gap-[2px] rounded-md border border-slate-800 bg-[#0b1220] p-1"
        style={{
          gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(14, minmax(0, 1fr))',
        }}
      >
        {screen.blocks.map((block) => {
          const lit = block.id === step.hotspot;
          return (
            <div
              key={block.id}
              style={{
                gridColumn: `${block.col[0]} / span ${block.col[1]}`,
                gridRow: `${block.row[0]} / span ${block.row[1]}`,
              }}
              className={`relative flex items-center justify-center overflow-hidden rounded-[2px] px-1 ${
                lit
                  ? 'z-10 bg-amber-500 ring-2 ring-amber-300'
                  : `${BLOCK_STYLES[block.kind]} opacity-60`
              }`}
            >
              {lit && (
                <span className="absolute -top-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-300 text-[8px] font-bold text-slate-900">
                  {index}
                </span>
              )}
              {block.label !== undefined && (
                <span
                  className={`truncate text-[7px] leading-none ${
                    lit ? 'font-semibold text-slate-900' : 'text-slate-500'
                  }`}
                >
                  {block.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-2 truncate font-mono text-[10px] text-slate-600">{screen.route}</p>
    </div>
  );
}

// ── The step list ────────────────────────────────────────────────────────────

function StepList({ index, onPick }: { index: number; onPick: (n: number) => void }) {
  return (
    <nav className="flex-1 p-2">
      {STEPS.map((step, i) => {
        const active = i === index;
        // The annex is a different thing from the walkthrough, so it gets a
        // divider rather than continuing the same numbered run.
        const startsAnnex = step.section === 'annex' && STEPS[i - 1]?.section !== 'annex';
        return (
          <div key={step.title}>
            {startsAnnex && (
              <div className="mt-3 mb-1 border-t border-slate-800 px-2 pt-2.5 text-[10px] font-semibold tracking-[0.12em] text-slate-600 uppercase">
                Annex · how it works
              </div>
            )}
          <button
            type="button"
            onClick={() => onPick(i)}
            className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition ${
              active
                ? 'bg-blue-600 font-medium text-white'
                : i < index
                  ? 'text-slate-600 hover:bg-slate-800/60'
                  : 'text-slate-400 hover:bg-slate-800/60'
            }`}
          >
            <span
              className={`w-4 shrink-0 text-right font-mono text-[10px] ${
                active ? 'text-blue-200' : 'text-slate-600'
              }`}
            >
              {i}
            </span>
            <span className="min-w-0 flex-1 truncate">{step.title}</span>
            {step.star === true && (
              <span className={active ? 'text-amber-300' : 'text-amber-500/70'}>★</span>
            )}
          </button>
          </div>
        );
      })}
    </nav>
  );
}

// ── The step ─────────────────────────────────────────────────────────────────

function StepDetail({ step, index }: { step: Step; index: number }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
        {step.section === 'annex' ? (
          <span className="text-violet-400">Annex · not part of the walkthrough</span>
        ) : (
          <>
            Step {index} of {WALKTHROUGH_COUNT - 1}
          </>
        )}
      </div>
      <h2 className="mt-1 flex items-start gap-2 text-2xl font-semibold text-white">
        {step.title}
        {step.star === true && <span className="mt-1 text-lg text-amber-400">★</span>}
      </h2>
      <div className="mt-1 text-xs text-slate-500">~{humanSeconds(step.seconds)}</div>

      <Panel tone="hover" label="Put the mouse here">
        {step.hover}
      </Panel>

      {step.watch !== undefined && (
        <Panel tone="watch" label="Watch out">
          {step.watch}
        </Panel>
      )}

      <Panel tone="say" label="Say">
        {step.say}
      </Panel>

      {step.backend !== undefined && (
        <Panel tone="backend" label="Under the hood — only if asked">
          {step.backend}
        </Panel>
      )}

      {step.ifAsked !== undefined && (
        <div className="mt-4 rounded-md border border-slate-800 bg-[#0b1220] p-4">
          <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
            If they ask
          </div>
          <dl className="mt-2.5 space-y-3">
            {step.ifAsked.map((qa) => (
              <div key={qa.q}>
                <dt className="text-sm font-medium text-slate-300">{qa.q}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-slate-400">{qa.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="text-[10px] font-semibold tracking-[0.12em] text-slate-500 uppercase">
          Then
        </div>
        <p className="mt-1 text-sm font-medium text-slate-200">{step.then}</p>
      </div>
    </div>
  );
}

const TONES = {
  hover: { bar: 'bg-emerald-400', text: 'text-emerald-400', body: 'text-slate-200' },
  watch: { bar: 'bg-amber-500', text: 'text-amber-400', body: 'text-slate-300' },
  say: { bar: 'bg-blue-500', text: 'text-blue-400', body: 'text-slate-100' },
  // Visually quieter than Say — it is reference material, not the script, and
  // reading it out unprompted is how a demo turns into a lecture.
  backend: { bar: 'bg-violet-500', text: 'text-violet-400', body: 'text-slate-400' },
} as const;

function Panel({
  tone,
  label,
  children,
}: {
  tone: keyof typeof TONES;
  label: string;
  children: React.ReactNode;
}) {
  const style = TONES[tone];
  return (
    <div className="mt-4 flex gap-3 rounded-md bg-[#0b1220] p-4">
      <div className={`w-0.5 shrink-0 rounded-full ${style.bar}`} />
      <div className="min-w-0">
        <div className={`text-[10px] font-semibold tracking-[0.12em] uppercase ${style.text}`}>
          {label}
        </div>
        <p
          className={`mt-1.5 leading-relaxed ${style.body} ${
            tone === 'say' ? 'text-[15px]' : 'text-sm'
          }`}
        >
          {children}
        </p>
      </div>
    </div>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────

function Footer({
  index,
  onGo,
  plannedSoFar,
}: {
  index: number;
  onGo: (n: number) => void;
  plannedSoFar: number;
}) {
  const next = STEPS[index + 1];

  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-slate-800 bg-[#0b1220] px-5 py-3">
      <button
        type="button"
        onClick={() => onGo(index - 1)}
        disabled={index === 0}
        className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-800 disabled:opacity-30"
      >
        ← Prev
      </button>
      <button
        type="button"
        onClick={() => onGo(index + 1)}
        disabled={index === STEPS.length - 1}
        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-30"
      >
        Next →
      </button>

      <div className="min-w-0 flex-1 truncate text-xs text-slate-600">
        {next !== undefined ? `Next: ${next.title}` : 'End of the walkthrough'}
      </div>

      <div className="hidden shrink-0 font-mono text-xs text-slate-600 sm:block">
        by here: {clock(plannedSoFar)}
      </div>
      <kbd className="hidden shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-600 md:block">
        ← → to move · T to time
      </kbd>
    </footer>
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

function clock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function humanSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} sec`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
}
