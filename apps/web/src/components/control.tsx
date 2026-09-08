import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from './ui';

/**
 * Shared furniture for the contractor's per-project control screens.
 *
 * Every screen the client sees has a contractor-side twin under
 * `/dashboard/projects/[id]/*`. The client screen is a read; the contractor
 * screen is where the thing is created, controlled, and released. These two
 * components are what make the twin read as a control surface rather than a
 * second copy of the client view:
 *
 *   - `ControlHeader` states plainly that this is the contractor's side and
 *     links straight to the client's own view of the same project, so a PM can
 *     check what they are actually serving.
 *   - `VisibilityTag` marks each row with whether the client can see it. The
 *     contractor sees everything, including the rows held back — that is the
 *     whole point of a control centre, and it is why these screens do not reuse
 *     the gated portal reads.
 */

export function ControlHeader({
  title,
  subtitle,
  clientHref,
  action,
}: {
  title: string;
  subtitle: string;
  /** The client's own view of this same screen, for one-click checking. */
  clientHref?: string;
  /** Primary control on the right — "New change order", "Publish schedule". */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">{title}</h1>
        <p className="mt-1 text-sm text-navy-400">{subtitle}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {clientHref !== undefined && (
          <Link
            href={clientHref}
            className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            Preview client view
          </Link>
        )}
        {action}
      </div>
    </div>
  );
}

/** A control-side button. Not wired — same fidelity as the client-side buttons. */
export function ControlButton({
  children,
  tone = 'primary',
}: {
  children: ReactNode;
  tone?: 'primary' | 'ghost';
}) {
  return (
    <button
      type="button"
      className={
        tone === 'primary'
          ? 'rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800'
          : 'rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50'
      }
    >
      {children}
    </button>
  );
}

/** Marks a row with whether the client can see it. Contractor sees both. */
export function VisibilityTag({ shown }: { shown: boolean }) {
  return shown ? (
    <Badge tone="good">Client sees this</Badge>
  ) : (
    <Badge tone="neutral">Hidden from client</Badge>
  );
}

/** The strip that reminds the contractor how the two sides relate. */
export function ControlNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-navy-100 bg-navy-50/60 px-5 py-3.5">
      <p className="text-sm leading-relaxed text-navy-600">{children}</p>
    </div>
  );
}

/** Empty state for a control screen with nothing seeded yet. */
export function ControlEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-navy-200 px-5 py-12 text-center">
      <p className="text-sm font-medium text-navy-900">{title}</p>
      <p className="mt-1 text-sm text-navy-400">{body}</p>
    </div>
  );
}
