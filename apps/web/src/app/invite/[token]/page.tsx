import { acceptInvitation } from '@/lib/actions';
import { getHubTeam, readInviteToken } from '@/lib/hub-db/team';
import { Card } from '@/components/ui';

/**
 * Accepting an invitation — where a crew member or homeowner sets a password.
 *
 * The token is checked twice and the two checks answer different questions.
 * Here: is this a well-formed, unexpired, correctly-signed invitation, so the
 * page can decide what to render. On submit: is it *still* unspent, which only
 * the database can answer and only at the moment of use.
 *
 * Doing the second check here as well would be a time-of-check/time-of-use bug:
 * two people opening the same link would both see the form, and both would
 * believe they had accepted it.
 */

export default async function AcceptInvite({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const hub = getHubTeam();

  const Frame = ({ children }: { children: React.ReactNode }) => (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <div className="w-full">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold tracking-tight text-navy-900">
            BuildSuite<span className="align-super text-xs">™</span>
          </div>
          <div className="mt-0.5 text-xs text-navy-400">Project Hub</div>
        </div>
        {children}
      </div>
    </main>
  );

  if (!hub.available) {
    return (
      <Frame>
        <Card className="px-6 py-8 text-center">
          <p className="text-sm text-navy-600">This invitation cannot be checked right now.</p>
          <p className="mt-1.5 text-xs text-navy-400">
            The Hub database is not connected. Ask whoever invited you to try again shortly.
          </p>
        </Card>
      </Frame>
    );
  }

  const check = readInviteToken(token, process.env.SESSION_SECRET!);
  if (!check.valid) {
    // Deliberately the same wording whichever way it failed. Telling an
    // unauthenticated visitor whether a link was expired, forged or for another
    // purpose is more than they need to know.
    return (
      <Frame>
        <Card className="px-6 py-8 text-center">
          <p className="text-sm font-medium text-navy-900">This invitation is no longer valid.</p>
          <p className="mt-1.5 text-xs text-navy-400">
            Invitations expire after 7 days and work once. Ask your contractor to send a new one.
          </p>
        </Card>
      </Frame>
    );
  }

  const roleLabel = check.payload.role === 'field' ? 'field crew' : 'client';

  return (
    <Frame>
      <Card className="px-6 py-7">
        <h1 className="text-base font-semibold text-navy-900">Set your password</h1>
        <p className="mt-1 text-sm text-navy-400">
          You have been invited as {roleLabel} for{' '}
          <span className="font-medium text-navy-600">{check.payload.email}</span>.
        </p>

        {error !== undefined && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error === 'weak-password'
              ? 'Please choose a password of at least 10 characters.'
              : error === 'already-used'
                ? 'This invitation has already been used. Ask for a new one.'
                : error === 'expired'
                  ? 'This invitation has expired. Ask for a new one.'
                  : 'This invitation could not be accepted. Ask for a new one.'}
          </p>
        )}

        <form action={acceptInvitation} className="mt-5 space-y-3">
          <input type="hidden" name="token" value={token} />
          <div>
            <label htmlFor="password" className="text-xs font-medium text-navy-600">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-navy-400">At least 10 characters.</p>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-navy-700"
          >
            Set password and continue
          </button>
        </form>
      </Card>

      <p className="mt-4 text-center text-xs text-navy-400">
        This link works once and expires 7 days after it was sent.
      </p>
    </Frame>
  );
}
