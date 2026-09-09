import { NextResponse, type NextRequest } from 'next/server';

/**
 * RETIRED — the emailed sign-in link (§9.2, C-2).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE NO LONGER MINTS ANYTHING (2026-09-10)
 *
 * This was the homeowner's door: `/signin` took an email and a project code,
 * located the record, and emailed a single-use signed token to the address on
 * it. This route consumed that token and opened the session.
 *
 * Chris replaced the whole path with the project code as the password, sent by
 * a BuildSuite automation the moment the contract is signed. Two doors for one
 * person is bad on its own; these two had DIFFERENT RULES, and the retired one
 * was the weaker of the pair in both directions that matter:
 *
 *   · it required no signature, so an unsigned project let a homeowner in;
 *   · it minted a session carrying `contactId`, which sends the portal down
 *     `listProjectsForContact` and returns EVERY project that contact holds —
 *     including ones whose code the visitor has never proved.
 *
 * Leaving it wired would have made the new signature gate decorative: an
 * attacker with a token, or anyone holding the pre-rotation `SESSION_SECRET`,
 * could bypass it entirely. So the route refuses instead of being deleted —
 * anyone who follows an old link is told what happened and sent to the door
 * that still works, rather than getting a 404 and phoning their contractor.
 *
 * The machinery behind it is intact and still tested — `auth/client-lookup.ts`,
 * `auth/sign-in-request.ts`, `auth/verification-token.ts`. Nothing reaches them
 * from a screen any more, which is what closes the door: a server action that
 * no component imports is not in the bundle and has no callable id. They are
 * kept because the design is sound and is the obvious answer if the code's six
 * bits are ever judged insufficient — see `auth/client-credentials.ts`.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

const REPLACED =
  'Sign-in links have been replaced. Use your email address and your project code to sign in.';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // The token is deliberately not read, not verified and not logged. There is
  // nothing here that could act on it, and a route that parses a credential it
  // will never honour is one refactor away from honouring it again.
  console.warn('[auth] refused a retired sign-in link');

  const url = new URL('/signin', request.nextUrl.origin);
  url.searchParams.set('error', REPLACED);
  return NextResponse.redirect(url);
}
