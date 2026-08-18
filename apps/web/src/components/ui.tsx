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
export function DataModeBanner({ live }: { live: boolean }) {
  if (live) return null;
  return (
    <div className="border-b border-amber-600/20 bg-amber-soft px-4 py-1.5 text-center text-xs text-amber-700">
      <strong className="font-semibold">Demo data</strong> — running on fixtures. Live GHL data
      connects once the integration token is issued.
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
        className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase ring-1 ring-red-600/20 ring-inset"
      >
        Internal
      </span>
    </span>
  );
}
