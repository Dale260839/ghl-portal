import { NextResponse, type NextRequest } from 'next/server';

import { describeRejection, verifyLanding } from '@/lib/auth/ghl-landing';
import { verifyGhlLocation } from '@/lib/auth/ghl-verify';
import { readGhlConfig } from '@/lib/ghl/config';
import { getBuildSuiteReader } from '@/lib/buildsuite/projects';
import { homeFor, setSession, type Role } from '@/lib/session';

/**
 * GoHighLevel Custom Menu Link landing (D-011, D-015).
 *
 * Mirrors what BuildSuite already does. Its menu link opens:
 *
 *   https://api.buildsuite.ai/api/v1/auth/ghl_auth_callback?locationId=IifYfP2B2NUaoDPdsTTa
 *
 * — one parameter. **The tenant is the sub-account, not a person.** Everything
 * the contractor then sees is scoped to that location, which is why a single
 * `locationId` is enough to establish a session.
 *
 * Our menu link is the same shape:
 *
 *   https://<domain>/api/auth/ghl?locationId={{location.id}}
 *
 * ---------------------------------------------------------------------------
 * The parameter is a CLAIM, not proof. GHL doesn't sign merge fields, so anyone
 * who learns this address could substitute another agency's location id. Before
 * minting anything we ask GHL — with our own credential — whether that location
 * is real and ours. A location we can't confirm gets no session.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

/**
 * One message per failure, because they need different actions. Measured
 * against the live API: an unreachable location returns 403, not 404.
 */
const LOCATION_ERRORS = {
  unknown_location: "That link doesn't match a sub-account we have access to.",
  // Ours to fix, not theirs — say so rather than implying a bad link.
  bad_credential: 'This site is not correctly connected to GoHighLevel yet.',
  lookup_failed: "Couldn't reach GoHighLevel just now. Please try again.",
} as const;

function reject(request: NextRequest, message: string): NextResponse {
  const url = new URL('/', request.nextUrl.origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;
  const ghlConfig = readGhlConfig();

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
      // The claim passes this first gate when we hold a credential to check it
      // with below. Without one, only the explicit development opt-in remains.
      allowUnverified:
        ghlConfig.configured ||
        (process.env.NODE_ENV !== 'production' &&
          process.env.GHL_ALLOW_UNVERIFIED_LANDING === 'true'),
    },
  );

  if (!landing.ok) {
    console.warn(`[auth] GHL landing refused: ${landing.reason}`);
    return reject(request, describeRejection(landing.reason));
  }

  const { locationId } = landing;

  // ── Prove the location ────────────────────────────────────────────────────
  if (landing.proof !== 'signature' && ghlConfig.configured) {
    const check = await verifyGhlLocation(locationId, ghlConfig.config);
    if (!check.verified) {
      console.warn(`[auth] Location verification failed for ${locationId}: ${check.reason}`);
      return reject(request, LOCATION_ERRORS[check.reason]);
    }
  } else if (landing.proof === 'unverified_development' && process.env.NODE_ENV === 'production') {
    // verifyLanding already refuses this, but production must never mint a
    // session on an unverified claim whatever the configuration says.
    return reject(request, 'Sign-in from GoHighLevel is not configured yet.');
  }

  // ── Resolve the tenant ────────────────────────────────────────────────────
  const reader = getBuildSuiteReader();
  if (!reader.available) {
    console.error(`[auth] BuildSuite unavailable: ${reader.missing.join(', ')}`);
    return reject(request, 'The project database is not configured yet.');
  }

  let authProfileIds: string[];
  try {
    authProfileIds = await reader.listAuthProfileIdsForLocation(locationId);
  } catch (error) {
    console.error('[auth] Failed to resolve BuildSuite profiles', error);
    return reject(request, "Couldn't load this account's projects. Please try again.");
  }

  if (authProfileIds.length === 0) {
    // The location is real but has no BuildSuite presence. Refusing beats a
    // session with no tenant, which renders empty screens that look like an
    // outage rather than a setup gap.
    console.warn(`[auth] No BuildSuite profiles for location ${locationId}`);
    return reject(
      request,
      'This sub-account is signed in, but has no BuildSuite projects linked to it yet.',
    );
  }

  // Everyone arriving through a GHL menu link is staff. Homeowners have no GHL
  // login — their path is separate and deliberately not guessed at here.
  const role: Role = 'contractor';

  await setSession({
    role,
    name: landing.email ?? 'GoHighLevel user',
    email: landing.email ?? '',
    authProfileIds,
    ghlLocationId: locationId,
  });

  console.log(
    `[auth] Signed in via GHL — location ${locationId}, ${authProfileIds.length} profile(s)`,
  );
  return NextResponse.redirect(new URL(homeFor(role), request.nextUrl.origin));
}
