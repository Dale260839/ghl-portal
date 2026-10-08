import type { ReactNode } from 'react';

import { isHealthStatus, lifecycleLabel } from '@/lib/status-vocabulary';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(10,31,68,0.06)] transition-[box-shadow,border-color] duration-200 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-navy-100 px-5 py-3.5">
      <h2 className="text-sm font-semibold tracking-wide text-navy-900 uppercase">{title}</h2>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'warn' | 'good';
}) {
  const accent =
    tone === 'warn'
      ? 'text-amber-accent'
      : tone === 'good'
        ? 'text-emerald-600'
        : 'text-navy-900';
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">{label}</div>
      <div className={`tabular mt-1.5 text-2xl font-semibold ${accent}`}>{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-xs text-navy-400">{sub}</div>}
    </Card>
  );
}

/**
 * Health earns a colour. Lifecycle does not — see `lib/status-vocabulary.ts`.
 *
 * `On Hold` and `Completed` arrive in the same field but are facts about the
 * project's life, not judgements about the work, so they render neutral. That
 * was already true by accident; it is true on purpose now, and tested.
 */
const HEALTH_TONES: Record<string, string> = {
  'On Track': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Attention Needed': 'bg-amber-soft text-amber-700 ring-amber-600/20',
  'At Risk': 'bg-red-50 text-red-700 ring-red-600/20',
  Delayed: 'bg-red-50 text-red-700 ring-red-600/20',
};

const NEUTRAL_TONE = 'bg-navy-100 text-navy-700 ring-navy-600/20';

export function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-navy-100 text-navy-700 ring-navy-600/20',
    good: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    warn: 'bg-amber-soft text-amber-700 ring-amber-600/20',
    bad: 'bg-red-50 text-red-700 ring-red-600/20',
    accent: 'bg-navy-900 text-white ring-navy-900',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone ?? 'neutral']}`}
    >
      {children}
    </span>
  );
}

export function HealthBadge({ status }: { status: string }) {
  const health = isHealthStatus(status);
  return (
    <span
      // The word carries the meaning; the colour only reinforces it. Colour
      // alone would leave the two red states — At Risk and Delayed — telling a
      // colour-blind PM the same thing, and tell a screen reader nothing.
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        HEALTH_TONES[status] ?? NEUTRAL_TONE
      }`}
      title={health ? `Project health: ${status}` : `Project status: ${status}`}
    >
      {status}
    </span>
  );
}

/**
 * Where a project is in its life — draft, awarded, active.
 *
 * Deliberately the quietest thing on the row. It was a bare lowercase word
 * sitting beside a coloured health pill, which read as one status system
 * behaving inconsistently rather than two answering different questions.
 */
export function LifecycleBadge({ status }: { status: string | null | undefined }) {
  const label = lifecycleLabel(status);
  return (
    <span
      className="inline-flex items-center rounded-md border border-navy-100 bg-navy-50 px-2 py-0.5 text-xs font-medium text-navy-500"
      title={`Project status: ${label}`}
    >
      {label}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
        <div
          className="bar-grow h-full rounded-full bg-navy-600 transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      {label !== false && (
        <span className="tabular w-9 shrink-0 text-right text-xs font-medium text-navy-600">
          {value}%
        </span>
      )}
    </div>
  );
}

export function currency(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Shown on every surface while the app is running on fixtures. A demo that
 * looks live but isn't is the fastest way to lose a client's trust later.
 */
/**
 * Names the source behind the screen.
 *
 * Three states, not two. "Sample data" and "real projects, but no field updates
 * yet" are different things to be looking at, and a presenter told the wrong one
 * gets contradicted by their own screen mid-sentence — which is exactly what
 * happened when the dashboard claimed to be live and was on fixtures.
 *
 * The fixture state is now only reachable when neither BuildSuite nor GHL is
 * configured — there is no longer a toggle that chooses it — so it means "this
 * deployment is misconfigured", not "someone flipped a switch".
 */
export function DataModeBanner({
  kind,
  hubConnected,
  hubProblem,
}: {
  kind: 'fixture' | 'buildsuite' | 'ghl';
  /**
   * Whether the Hub database is reachable from this deployment.
   *
   * The banner used to say "field updates, milestones and budgets arrive once
   * this deployment is connected to the Hub database" as fixed text, whether or
   * not it was connected. It has been connected for over a week — invitations,
   * team management and invoice drafts all write to it — so the banner was
   * telling every contractor that working features did not exist yet.
   *
   * Optional, so a caller that genuinely cannot tell says nothing rather than
   * guessing: `undefined` is treated as healthy and shows no banner.
   */
  hubConnected?: boolean;
  /**
   * Why the Hub is not connected, when the caller knows — e.g. the key is the
   * publishable one, which migration 0010 locked out.
   *
   * "Not reachable" was the only wording, and on 2026-09-12 it was wrong: the
   * database was reachable and refusing the key. That sends someone looking at
   * the network for a problem that is one environment variable.
   *
   * CONTRACTOR SCREENS ONLY. The portal and field layouts deliberately do not
   * pass this: an environment variable name is operator detail, and it has no
   * business on a homeowner's screen.
   */
  hubProblem?: string;
}) {
  if (kind === 'ghl') return null;

  if (kind === 'buildsuite') {
    // Healthy: say nothing. A "Live BuildSuite data — real projects, clients and
    // dates … saving to the Hub database" strip used to sit across the top of
    // every screen; it was removed on request on 2026-09-15. Live data is the
    // normal state, so the banner now speaks only when saving is broken.
    if (hubConnected !== false) return null;
    return (
      <div className="border-b border-amber-600/20 bg-amber-soft px-4 py-1.5 text-center text-xs text-amber-700">
        {hubProblem !== undefined && hubProblem !== '' ? (
          <>
            The Hub database is not connected (missing {hubProblem}), so schedule, field updates
            and invoices cannot be saved.
          </>
        ) : (
          <>
            The Hub database is not reachable, so schedule, field updates and invoices cannot be
            saved.
          </>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-amber-600/20 bg-amber-soft px-4 py-1.5 text-center text-xs text-amber-700">
      <strong className="font-semibold">Demo data</strong> — running on fixtures. Neither BuildSuite
      nor GHL is reachable from this deployment.
    </div>
  );
}

/** Marks fields that never reach the client (§9.3). */
export function InternalOnly({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <span
        title="Internal only — never serialized into a client response (§9.3)"
        className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold tracking-wide text-amber-accent uppercase ring-1 ring-amber-accent/30 ring-inset"
      >
        Internal
      </span>
    </span>
  );
}

/**
 * A block of text the client will never see.
 *
 * **Amber, not red.** These notes are the system working exactly as intended —
 * a crew member being candid, a permit delay recorded honestly. Red says
 * something has broken, which sends a contractor looking for a fault that is not
 * there, and makes a demo of the withholding feature read as a page full of
 * errors. The left rule and the Internal tag carry the meaning; the colour only
 * has to say "handle differently".
 *
 * Red stays reserved for actual failures — an unreachable database, a refused
 * sign-in.
 *
 * One component rather than four copies, so the next change to how internal
 * content looks happens in one place.
 */
export function InternalNote({
  label,
  children,
  footnote,
  size = 'sm',
}: {
  label: string;
  children: ReactNode;
  /** Optional line under the body — e.g. why it cannot be published. */
  footnote?: string;
  size?: 'sm' | 'xs';
}) {
  const body = size === 'sm' ? 'text-sm' : 'text-xs';
  return (
    <div className="rounded-md border-l-2 border-amber-accent bg-amber-soft px-3 py-2">
      <InternalOnly>
        <span className="text-xs font-semibold tracking-wide text-amber-accent uppercase">
          {label}
        </span>
      </InternalOnly>
      <p className={`mt-1.5 ${body} text-amber-900`}>{children}</p>
      {footnote !== undefined && <p className="mt-2 text-xs text-amber-900/70">{footnote}</p>}
    </div>
  );
}

/**
 * The portal's empty state.
 *
 * Used wherever a client legitimately sees nothing — a contractor hasn't shared
 * the schedule, messaging is switched off, a section isn't relevant yet. The
 * wording always says *why*, because "nothing here" reads as a broken page and
 * "your contractor hasn't shared this yet" reads as a system working correctly.
 */
export function PortalEmpty({
  title,
  body,
  tiles,
}: {
  title: string;
  body: string;
  tiles?: { label: string; hint: string }[];
}) {
  return (
    <div className="rounded-xl border border-dashed border-navy-200 px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-navy-100">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-navy-400">
          <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        </svg>
      </div>
      <p className="text-base font-medium text-navy-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-navy-400">{body}</p>
      {tiles !== undefined && (
        <div className="mx-auto mt-7 grid max-w-2xl gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border border-navy-100 px-4 py-4">
              <div className="text-sm font-medium text-navy-600">{t.label}</div>
              <div className="mt-0.5 text-xs text-navy-400">{t.hint}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The top of a top-level screen: where you are, what it is for, what you can do.
 *
 * Written out by hand on every page, which is why the sizes drifted — an `h1`
 * at `text-xl` on one screen and `text-2xl` on the next, a description on some
 * and not others. The per-project screens already had `ControlHeader`; this is
 * the same idea for everything above them.
 *
 * `description` is deliberately optional. The brief's own rule: do not repeat
 * an explanation on every page. A screen whose title says it all gets a title.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  /** Secondary first, primary last — the order they are read in. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-navy-400">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A collection with nothing in it yet.
 *
 * Says what is missing, why it is missing, and what to do about it — in that
 * order. "No projects found" is none of those three: it reports a query result
 * to somebody who did not run a query.
 *
 * The action is optional because some of these are genuinely nobody's to fix
 * from this screen — a crew member's task list fills up when a PM assigns work,
 * and offering them a button would be a lie.
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-navy-200 px-6 py-12 text-center">
      <p className="text-sm font-medium text-navy-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-navy-400">{body}</p>
      {action !== undefined && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
