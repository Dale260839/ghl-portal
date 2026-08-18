import { NextResponse, type NextRequest } from 'next/server';

import { describeRejection, verifyLanding } from '@/lib/auth/ghl-landing';
import { verifyGhlUser } from '@/lib/auth/ghl-verify';
import { readGhlConfig } from '@/lib/ghl/config';
import { getBuildSuiteReader } from '@/lib/buildsuite/projects';
import { homeFor, setSession, type Role } from '@/lib/session';

/**
 * GoHighLevel Custom Menu Link landing (D-011).
 *
 * A user already signed in to GHL clicks our menu item, arrives here, and leaves
 * with a Hub session. No second login.
 *
 * ---------------------------------------------------------------------------
 * HOW THE LANDING IS PROVEN
 *
 * The URL's parameters are a **claim**, never proof — GHL does not sign menu
 * link merge fields, so anyone who learns this address could supply a location
 * of their choosing. Since tenancy comes from the session, that would be
 * choosing whose data to receive.
 *
 * Three modes, strongest first:
 *
 *   1. **Signature** — if GHL is ever configured to send one, verify it.
 *   2. **API verification** — ask GHL, with our own credential, whether that
 *      user really belongs to that location. This is the normal path.
 *   3. **Development** — explicit opt-in, never in production.
 *
 * If none apply, the landing is refused. Failing to sign anyone in is a support
 * ticket; signing in the wrong person is a breach.
 * ---------------------------------------------------------------------------
 *
 * Register as the Custom Menu Link target:
 *
 *   /api/auth/ghl?locationId={{location.id}}&userId={{user.id}}&email={{user.email}}
 */

export const dynamic = 'force-dynamic';

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
      // The claim is allowed through the first check when we can verify it
      // against the API below. Without a credential there is nothing to verify
      // with, so only the explicit development opt-in remains.
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

  // ── Proof ─────────────────────────────────────────────────────────────────
  let proof = landing.proof;
  let email = landing.email;
  let displayName = landing.email ?? landing.userId;

  if (landing.proof !== 'signature' && ghlConfig.configured) {
    const check = await verifyGhlUser(
      { locationId: landing.locationId, userId: landing.userId },
      { ...ghlConfig.config, locationId: landing.locationId },
    );

    if (!check.verified) {
      // Includes the forged-location case, and a GHL outage. Both refuse.
      console.warn(`[auth] GHL verification failed: ${check.reason}`);
      return reject(
        request,
        check.reason === 'lookup_failed'
          ? "Couldn't reach GoHighLevel to confirm your account. Please try again."
          : "That link doesn't match a user in this sub-account.",
      );
    }

    proof = 'signature';
    // GHL is the authority on the user's identity, not the URL.
    email = check.user.email !== '' ? check.user.email : email;
    displayName = check.user.name !== '' ? check.user.name : displayName;
  } else if (landing.proof === 'unverified_development' && process.env.NODE_ENV === 'production') {
    // Belt and braces: verifyLanding already refuses this, but production must
    // never mint a session on an unverified claim, whatever the config says.
    return reject(request, 'Sign-in from GoHighLevel is not configured yet.');
  }

  // ── Tenant ────────────────────────────────────────────────────────────────
  const authProfileId = await resolveAuthProfileId(email, landing.locationId);

  if (authProfileId === null) {
    // Authenticated, but not linked to a BuildSuite profile — so there is no
    // tenant whose data they could see. Refusing beats issuing a session with
    // no scope, which renders empty screens that look like an outage.
    console.warn(`[auth] No BuildSuite profile for ${email ?? landing.userId}`);
    return reject(
      request,
      'Signed in to GoHighLevel, but this user is not linked to a BuildSuite profile yet.',
    );
  }

  // Everyone arriving through a GHL menu link is staff. Homeowners have no GHL
  // login — their path is still open (D-011) and deliberately not guessed at.
  const role: Role = 'contractor';

  await setSession({
    role,
    name: displayName,
    email: email ?? '',
    authProfileId,
    ghlLocationId: landing.locationId,
  });

  console.log(`[auth] GHL landing accepted (${proof}) for ${landing.locationId}`);
  return NextResponse.redirect(new URL(homeFor(role), request.nextUrl.origin));
}

/**
 * Maps a GHL user onto BuildSuite's `auth_profiles.id` — the tenant key.
 *
 * Matched on email AND location, since `auth_profiles` carries `location_id`.
 * Still not ideal: once the GHL user id is stored against the profile this
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
