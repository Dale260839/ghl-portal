import { isGhlLocationId } from '@/lib/ghl/config';
import { oauthEnabled } from '@/lib/ghl/oauth-config';

/**
 * Onboarding: the first screen a brand-new contractor sees.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT BEHIND SIGN-IN
 *
 * It cannot be. A contractor whose sub-account has never been connected cannot
 * sign in at all: the Hub proves a sub-account by calling GoHighLevel with a
 * credential for it, and the credential is the very thing that is missing. That
 * is the dead end their menu link hit on 2026-09-23 — *"That link doesn't match
 * a sub-account we have access to"* — with nothing to do about it.
 *
 * So this page stands in front of the door rather than behind it, and the
 * authority for connecting is **GoHighLevel's own approval screen**, which only
 * somebody with access to that sub-account can complete. That is a stronger
 * gate than a session we cannot issue anyway.
 *
 * WHAT IT MAY SHOW
 *
 * Nothing about the project, the contractor or the client — no read happens
 * here. Only the sub-account id already in the URL, which the visitor brought
 * with them. The page is a door, and a door does not know who is behind it.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  const { locationId } = await searchParams;
  const location = isGhlLocationId(locationId) ? locationId.trim() : null;
  const live = oauthEnabled();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">Project Hub</p>
        <h1 className="text-2xl font-semibold text-slate-900">Connect your account</h1>
        <p className="text-slate-600">
          One approval and Project Hub is set up for you. There is nothing to configure and no keys
          to enter.
        </p>
      </div>

      <ol className="space-y-4 border-y border-slate-200 py-6 text-sm text-slate-700">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            1
          </span>
          <span>
            <strong className="font-semibold text-slate-900">Approve access.</strong> You will be
            asked to allow Project Hub to work with your contacts, conversations and invoices —
            which is how it sends invoices and appointment emails on your behalf.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            2
          </span>
          <span>
            <strong className="font-semibold text-slate-900">You come straight back here.</strong>{' '}
            Your projects, clients and payment schedules are already waiting; nothing has to be
            imported or set up.
          </span>
        </li>
      </ol>

      {live ? (
        <div className="space-y-3">
          <a
            href={location === null ? '/api/connect/start' : `/api/connect/start?locationId=${location}`}
            className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Connect
          </a>
          <p className="text-xs text-slate-500">
            You need to be signed in to that account first. If you are not, you will be asked to.
          </p>
        </div>
      ) : (
        // The switch is off on this deployment. Saying "Connect" would send
        // somebody round a loop that cannot finish.
        <p className="rounded-lg bg-amber-soft px-4 py-3 text-sm text-amber-700">
          Connecting is not switched on for this site yet. Ask whoever set up Project Hub for you.
        </p>
      )}

      {location !== null && (
        <p className="text-xs text-slate-400">
          Account <code className="font-mono">{location}</code>
        </p>
      )}
    </main>
  );
}
