import { NextResponse, type NextRequest } from 'next/server';

import { describeRejection, verifyLanding } from '@/lib/auth/ghl-landing';
import { verifyGhlLocation } from '@/lib/auth/ghl-verify';
import { readGhlConfig } from '@/lib/ghl/config';
import { configForLocation } from '@/lib/ghl/resolve-config';
import { oauthEnabled } from '@/lib/ghl/oauth-config';
import { locationConnected } from '@/lib/ghl/resolve-config';
import { hasTriedConnecting, markConnectAttempted } from '@/lib/connect-attempt';
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

/**
 * Answers in whichever shape the caller asked for.
 *
 * The authenticating page fetches with `?json=1` so it can show a failure in
 * place rather than bouncing to sign-in with the message in a URL. A direct hit
 * — someone opening the link with no page around it — still redirects, so the
 * endpoint keeps working on its own.
 */
function reject(request: NextRequest, message: string): NextResponse {
  if (request.nextUrl.searchParams.get('json') === '1') {
    return NextResponse.json({ ok: false, error: message });
  }
  const url = new URL('/', request.nextUrl.origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

function accept(request: NextRequest, to: string): NextResponse {
  if (request.nextUrl.searchParams.get('json') === '1') {
    return NextResponse.json({ ok: true, redirectTo: to });
  }
  return NextResponse.redirect(new URL(to, request.nextUrl.origin));
}

/**
 * A merge field GoHighLevel never substituted.
 *
 * Saving the menu link as `?locationId={{location.id}}` and having GHL not
 * interpolate it delivers the literal braces here. Down the normal path that
 * surfaces as "this sub-account doesn't exist", which sends someone hunting a
 * permissions problem that was never there.
 */
function isUnsubstitutedPlaceholder(value: string): boolean {
  return value.includes('{{') || value.includes('}}');
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

  if (isUnsubstitutedPlaceholder(locationId)) {
    console.warn(`[auth] Menu link merge field was not substituted: ${locationId}`);
    return reject(
      request,
      "GoHighLevel didn't fill in the sub-account — put its ID directly in the menu link URL.",
    );
  }

  // ── Prove the location ────────────────────────────────────────────────────
  if (landing.proof !== 'signature' && ghlConfig.configured) {
    // Verified with THAT sub-account's own credential, not with whichever token
    // happens to be the default. With the Marketplace install switched on this
    // is the token minted for the location, so the check becomes "is the app
    // installed there" — which is the honest question. Without it, this is the
    // per-location Private Integration token exactly as before.
    const check = await verifyGhlLocation(
      locationId,
      await configForLocation(ghlConfig.config, locationId),
    );
    if (!check.verified) {
      console.warn(`[auth] Location verification failed for ${locationId}: ${check.reason}`);

      // ── The dead end that is really onboarding ────────────────────────────
      //
      // `unknown_location` means we hold no credential that can see this
      // sub-account. For a contractor who has never connected, that is not a
      // bad link — it is the whole of their setup, and the honest answer is
      // "connect and you are in", not "that link doesn't match a sub-account
      // we have access to" with nowhere to go. Measured on 2026-09-23, when a
      // new sub-account's menu link did exactly that.
      //
      // Only when connecting is switched on and could actually finish. The
      // page reads nothing and shows nothing but the id already in the URL.
      if (check.reason === 'unknown_location' && oauthEnabled()) {
        // First time: send them straight at the approval screen. They came here
        // to open Project Hub, not to read about why they cannot.
        if (!(await hasTriedConnecting())) {
          await markConnectAttempted();
          return NextResponse.redirect(
            new URL(
              `/api/connect/start?locationId=${encodeURIComponent(locationId)}&auto=1`,
              request.nextUrl.origin,
            ),
            { headers: { 'Cache-Control': 'no-store' } },
          );
        }
        // They have been round this once already and are still not connected.
        // Explain, and let them choose — never loop.
        return NextResponse.redirect(
          new URL(`/connect?locationId=${encodeURIComponent(locationId)}`, request.nextUrl.origin),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

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

  // ── Connect on the way in, rather than asking ─────────────────────────────
  //
  // GoHighLevel will not issue a token for a sub-account without an approval
  // from somebody who has access to it. That screen is theirs and cannot be
  // skipped. What CAN go is every click on our side: a contractor whose account
  // is not connected is taken straight to it, approves once, and lands on their
  // dashboard. They never see a button of ours, and nobody ever handles a key.
  //
  // Once per browser per week (`connect-attempt.ts`), because this flow can end
  // without connecting — a closed tab, a decline, an error — and sending
  // somebody round the same loop on every page view is worse than the problem.
  // After that the banner asks instead, and they choose their moment.
  if (oauthEnabled() && !(await hasTriedConnecting())) {
    const connected = await locationConnected(locationId);
    if (connected === false) {
      await markConnectAttempted();
      return accept(
        request,
        `/api/connect/start?locationId=${encodeURIComponent(locationId)}&auto=1`,
      );
    }
  }

  return accept(request, homeFor(role));
}
