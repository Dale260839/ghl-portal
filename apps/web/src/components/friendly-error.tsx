'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { Role } from '@/lib/demo-accounts';
import {
  checkSessionForArea,
  HOME_FOR_ROLE,
  isRole,
  ROLE_PHRASE,
  type SessionCheck,
} from '@/lib/session-mismatch';

/**
 * What a person sees when a screen or a save fails.
 *
 * Next's default is a blank page reading "Application error: a server-side
 * exception has occurred" with a digest. Chris hit exactly that on 11 Sep when
 * a selection could not be saved: the row was refused by the database and the
 * whole workspace went white. Nothing was lost, but the page said nothing
 * useful and offered nothing to click.
 *
 * Production omits the error message on purpose (it may name tables or keys),
 * so this cannot say precisely what failed. It can say that nothing is lost,
 * offer to try again, and offer the way back. The digest stays visible so the
 * server log can be matched to what the person saw.
 *
 * ---------------------------------------------------------------------------
 * IT ASKS WHO IS SIGNED IN FIRST (2026-09-17)
 *
 * One browser holds one sign-in. A contractor's page left open while the same
 * browser signs in as crew or a homeowner fails every save — correctly — and
 * this page used to blame the Hub database for it. It now checks the current
 * role (`/api/session`) and, when it no longer fits this screen, says that
 * instead. See `lib/session-mismatch.ts`.
 * ---------------------------------------------------------------------------
 */
export function FriendlyError({
  error,
  reset,
  backHref,
  backLabel,
  what,
  allowedRoles,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
  what: string;
  /** Who this screen belongs to. A contractor may also preview field and portal screens. */
  allowedRoles: readonly Role[];
}) {
  const [check, setCheck] = useState<SessionCheck | 'checking'>('checking');
  // A string, not the array: a caller passing a fresh array literal each render
  // would otherwise re-run the check forever.
  const roleKey = allowedRoles.join(',');

  useEffect(() => {
    const allowed = roleKey.split(',').filter(isRole);
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/session', { cache: 'no-store' });
        const body = (await response.json()) as { role?: unknown };
        const role = isRole(body.role) ? body.role : null;
        if (!cancelled) setCheck(checkSessionForArea(allowed, role));
      } catch {
        // Could not ask. Fall back to the general message rather than guess.
        if (!cancelled) setCheck({ kind: 'match' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleKey]);

  const reference =
    error.digest !== undefined ? (
      <p className="mt-5 font-mono text-[11px] text-navy-400">Reference {error.digest}</p>
    ) : null;

  if (check !== 'checking' && check.kind === 'signed-out') {
    return (
      <Panel title="You are signed out in this browser.">
        <p>
          Nothing was changed. Your sign-in ended — it lasts eight hours, or you signed out in
          another tab. Contractors: open Project Hub again from the BuildSuite menu in GoHighLevel.
          Field crew and homeowners: sign in again.
        </p>
        <Actions>
          <PrimaryLink href="/">Go to sign-in</PrimaryLink>
        </Actions>
        {reference}
      </Panel>
    );
  }

  if (check !== 'checking' && check.kind === 'other-role') {
    const wantsContractor = allowedRoles.length === 1 && allowedRoles[0] === 'contractor';
    return (
      <Panel title="This browser is signed in as someone else now.">
        <p>
          Nothing was changed. Since this page was opened, this browser signed in as{' '}
          {ROLE_PHRASE[check.role]} — in another tab, or through an invitation or password-reset
          link — and a browser holds one sign-in at a time, so this page can no longer save.
        </p>
        <p className="mt-2">
          {wantsContractor
            ? 'To get back to the contractor view, open Project Hub from the BuildSuite menu in GoHighLevel. '
            : ''}
          To try crew or homeowner sign-in without losing your own, use a private window.
        </p>
        <Actions>
          <PrimaryLink href={HOME_FOR_ROLE[check.role]}>
            Continue as {ROLE_PHRASE[check.role]}
          </PrimaryLink>
        </Actions>
        {reference}
      </Panel>
    );
  }

  return (
    <Panel title="That did not go through.">
      {check === 'checking' ? (
        <p>Checking what happened…</p>
      ) : (
        <p>
          {what} could not be loaded or saved just now. Nothing you had already saved is lost. If
          you were adding something, it was not added; try once more, and if it fails again the Hub
          database refused the write and the team needs to look at it.
        </p>
      )}
      <Actions>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
        >
          Try again
        </button>
        <Link
          href={backHref}
          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
        >
          {backLabel}
        </Link>
      </Actions>
      {reference}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl border border-navy-100 bg-white px-6 py-8 text-center shadow-sm">
      <p className="text-base font-semibold text-navy-900">{title}</p>
      <div className="mt-2 text-sm leading-relaxed text-navy-600">{children}</div>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-center justify-center gap-3">{children}</div>;
}

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
    >
      {children}
    </Link>
  );
}
