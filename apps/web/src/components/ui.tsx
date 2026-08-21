import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(10,31,68,0.06)] ${className}`}
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

const HEALTH_TONES: Record<string, string> = {
  'On Track': 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  'Attention Needed': 'bg-amber-soft text-amber-700 ring-amber-600/20',
  'At Risk': 'bg-red-50 text-red-700 ring-red-600/20',
  Delayed: 'bg-red-50 text-red-700 ring-red-600/20',
  'On Hold': 'bg-navy-100 text-navy-700 ring-navy-600/20',
  Completed: 'bg-navy-100 text-navy-700 ring-navy-600/20',
};

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
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        HEALTH_TONES[status] ?? HEALTH_TONES['On Hold']
      }`}
    >
      {status}
    </span>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
        <div
          className="h-full rounded-full bg-navy-600 transition-[width]"
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
 * Three states, not two. "Demo data" and "real projects, but no field updates
 * yet" are different things to be looking at, and a presenter told the wrong one
 * gets contradicted by their own screen mid-sentence — which is exactly what
 * happened when the dashboard claimed to be live and was on fixtures.
 */
export function DataModeBanner({ kind }: { kind: 'fixture' | 'buildsuite' | 'ghl' }) {
  if (kind === 'ghl') return null;

  if (kind === 'buildsuite') {
    return (
      <div className="border-b border-navy-200 bg-navy-50 px-4 py-1.5 text-center text-xs text-navy-600">
        <strong className="font-semibold">Live BuildSuite data</strong> — real projects, clients and
        dates. Field updates, milestones and budgets need the Hub tables, which are not created yet.
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
