'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type State =
  | { phase: 'connecting' }
  | { phase: 'failed'; message: string; hint?: string }
  | { phase: 'done' };

/**
 * A merge field GHL never substituted.
 *
 * If the menu link is saved as `?locationId={{location.id}}` and GoHighLevel
 * doesn't interpolate it, the literal braces arrive here. Left to the normal
 * path that surfaces as "this sub-account doesn't exist", which sends someone
 * hunting a permissions problem that isn't there. Naming it precisely is the
 * difference between a two-minute fix and an afternoon.
 */
function looksUnsubstituted(locationId: string): boolean {
  return locationId.includes('{{') || locationId.includes('}}');
}

export function Connecting({ locationId }: { locationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ phase: 'connecting' });

  useEffect(() => {
    if (locationId === '') {
      setState({
        phase: 'failed',
        message: 'This link is missing its sub-account.',
        hint: 'The Custom Menu Link needs a locationId on the end of the URL.',
      });
      return;
    }

    if (looksUnsubstituted(locationId)) {
      setState({
        phase: 'failed',
        message: 'GoHighLevel did not fill in the sub-account.',
        hint: `The link arrived with "${locationId}" instead of a real ID, so the merge field wasn't substituted. Put the sub-account's ID directly in the menu link URL.`,
      });
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/ghl?json=1&locationId=${encodeURIComponent(locationId)}`,
          { cache: 'no-store' },
        );
        const body = (await response.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;

        if (body.ok === true) {
          setState({ phase: 'done' });
          // replace, not push — nobody should be able to go "back" into a
          // half-finished sign-in.
          router.replace('/dashboard');
          return;
        }

        setState({ phase: 'failed', message: body.error ?? 'Sign-in failed.' });
      } catch {
        if (cancelled) return;
        setState({
          phase: 'failed',
          message: "Couldn't reach the server.",
          hint: 'Check your connection and open the link again from GoHighLevel.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locationId, router]);

  return (
    <main className="grid min-h-dvh place-items-center bg-navy-50 px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-7 flex h-11 w-11 items-center justify-center rounded-xl bg-navy-900 text-sm font-bold text-white">
          B
        </div>

        {state.phase !== 'failed' ? (
          <>
            <div
              className="mx-auto mb-5 h-6 w-6 animate-spin rounded-full border-2 border-navy-200 border-t-navy-900"
              role="status"
              aria-label="Signing in"
            />
            <h1 className="text-lg font-semibold tracking-tight text-navy-900">
              Signing you in
            </h1>
            <p className="mt-1.5 text-sm text-navy-400">
              Confirming your GoHighLevel account and loading your projects.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="text-red-600"
                aria-hidden="true"
              >
                <path d="M12 8v5M12 17h.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-navy-900">
              {state.message}
            </h1>
            {state.hint !== undefined && (
              <p className="mt-2 text-sm leading-relaxed break-words text-navy-400">{state.hint}</p>
            )}
            <a
              href="/"
              className="mt-6 inline-block rounded-lg border border-navy-200 bg-white px-4 py-2.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              Go to sign-in
            </a>
          </>
        )}
      </div>
    </main>
  );
}
