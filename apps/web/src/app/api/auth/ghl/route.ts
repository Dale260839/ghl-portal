import { NextResponse, type NextRequest } from 'next/server';

import { describeRejection, verifyLanding } from '@/lib/auth/ghl-landing';
import { getBuildSuiteReader } from '@/lib/buildsuite/projects';
import { homeFor, setSession, type Role } from '@/lib/session';

/**
 * GHL Custom Menu Link landing (D-011).
 *
 * A contractor signed in to GoHighLevel clicks our menu item and arrives here.
 * We verify the landing, resolve who they are, mint a session, and send them to
 * their dashboard. No second login.
 *
 * Register this URL as the Custom Menu Link target, with these merge fields:
 *
 *   /api/auth/ghl?locationId={{location.id}}&userId={{user.id}}&email={{user.email}}
 *
 * plus `&timestamp=` and `&signature=` once signing is configured.
 */

export const dynamic = 'force-dynamic';

function reject(request: NextRequest, message: string): NextResponse {
  const url = new URL('/', request.nextUrl.origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;

  const landing = verifyLanding(
    {
      locationId: q.get('locationId') ?? undefined,
      userId: q.get('userId') ?? undefined,
      email: q.get('email') ?? undefined,
      signature: q.get('signature') ?? undefined,
      timestamp: q.get('timestamp') ?? undefined,
    },
    {
      signingSecret: process.env.GHL_MENU_LINK_SECRET,
      // Opt-in, development only, and never a fallback when a secret exists.
      allowUnverified:
        process.env.NODE_ENV !== 'production' &&
        process.env.GHL_ALLOW_UNVERIFIED_LANDING === 'true',
    },
  );

  if (!landing.ok) {
    console.warn(`[auth] GHL landing refused: ${landing.reason}`);
    return reject(request, describeRejection(landing.reason));
  }

  // The landing proves *who* and *where*. It does not prove what they may see —
  // that still comes from the tenant key below, and every read is scoped by it.
  const authProfileId = await resolveAuthProfileId(landing.email, landing.locationId);

  if (authProfileId === null) {
    // Authenticated, but not matched to a BuildSuite profile. Refusing beats
    // issuing a session with no tenant, which would render empty dashboards
    // that look like an outage rather than a setup problem.
    console.warn(`[auth] No BuildSuite profile for ${landing.email ?? landing.userId}`);
    return reject(
      request,
      'Signed in to GoHighLevel, but this user is not linked to a BuildSuite profile yet.',
    );
  }

  // Role: everyone arriving through a GHL menu link is staff. Homeowners do not
  // have GHL logins — their path is still open (see D-011) and deliberately not
  // guessed at here.
  const role: Role = 'contractor';

  await setSession({
    role,
    name: landing.email ?? landing.userId,
    email: landing.email ?? '',
    authProfileId,
    ghlLocationId: landing.locationId,
  });

  console.log(`[auth] GHL landing accepted (${landing.proof}) for ${landing.locationId}`);
  return NextResponse.redirect(new URL(homeFor(role), request.nextUrl.origin));
}

/**
 * Maps a GHL user onto BuildSuite's `auth_profiles.id` — the tenant key.
 *
 * Matched on email AND location, since `auth_profiles` carries `location_id`.
 * Still not ideal — once the GHL user id is stored against the profile this
 * becomes an exact lookup. Flagged rather than hidden, because a fuzzy join is
 * the sort of thing that quietly becomes permanent.
 */
async function resolveAuthProfileId(
  email: string | null,
  locationId: string,
): Promise<string | null> {
  if (email === null || email === '') return null;

  const reader = getBuildSuiteReader();
  if (!reader.available) return null;

  try {
    return await reader.findAuthProfileId({ email, locationId });
  } catch (error) {
    console.error('[auth] Failed to resolve the BuildSuite profile', error);
    return null;
  }
}
