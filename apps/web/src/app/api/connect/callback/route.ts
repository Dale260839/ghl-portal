import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { verify } from '@/lib/auth/session-crypto';
import { readOauthConfig } from '@/lib/ghl/oauth-config';
import { exchangeCode } from '@/lib/ghl/oauth-tokens';
import { resetLocationTokens } from '@/lib/ghl/oauth-location';
import { resetResolvedConfig } from '@/lib/ghl/resolve-config';
import { isGhlLocationId } from '@/lib/ghl/config';
import { getHubGhlOauth } from '@/lib/hub-db/ghl-oauth';

/**
 * Step two: GoHighLevel returns here with a one-time code, which becomes that
 * sub-account's tokens.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE MUST NEVER DO
 *
 * Show a token. Not in the HTML, not in an error, not in a log line. Everything
 * below reports ids and counts; the secrets go straight into the database row
 * and are never read back out to a response.
 *
 * WHY IT DOES NOT SWITCH ITSELF ON
 *
 * Completing an install changes nothing about how requests resolve credentials.
 * That still takes `GHL_OAUTH_ENABLED=true`, set deliberately, separately, by a
 * person who is watching. An install that silently redirected a contractor's
 * API calls onto a brand-new path the moment somebody clicked Approve is
 * exactly the kind of change that cannot be undone calmly.
 * ---------------------------------------------------------------------------
 */

function page(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${title}</title>` +
      `<body style="font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color:#1a1a1a">` +
      `<h1 style="font-size:1.4rem">${title}</h1>${body}</body>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const q = request.nextUrl.searchParams;

  // GoHighLevel reports a refusal in the URL rather than by status code.
  const refused = q.get('error');
  if (refused !== null) {
    return page('The install was not approved', `<p>GoHighLevel said: ${escapeHtml(refused)}.</p>`, 400);
  }

  const code = (q.get('code') ?? '').trim();
  const state = (q.get('state') ?? '').trim();
  if (code === '') return page('Nothing to install', '<p>GoHighLevel sent no code.</p>', 400);

  // ── Where did this install come from? ─────────────────────────────────────
  //
  // Two routes exist, and only one of them can carry our signature.
  //
  //   · Started at /api/connect/start — the `state` is ours, signed with the
  //     same HMAC that protects sessions. Proof the flow began here.
  //   · Started inside GoHighLevel's own App Marketplace — no `state` of ours,
  //     because we were never asked. Forced on us on 2026-09-23: a paid app
  //     "can only be installed within the platform", and an app's pricing
  //     cannot be edited once its version is published.
  //
  // So a signed state is preferred and a missing one is allowed, with the
  // contractor session below as the gate either way. What that costs: someone
  // could induce a signed-in contractor to complete an install for a
  // sub-account the attacker controls. The damage is one unusable row — it is
  // keyed by the location GoHighLevel names, so it cannot overwrite another
  // sub-account's credential, and reaching any data still requires a BuildSuite
  // auth profile for that location. Worth the trade; a session is not.
  const secret = process.env.SESSION_SECRET ?? '';
  const checked = verify<{ purpose?: unknown }>(state, secret);
  const signed = checked.valid && checked.payload.purpose === 'ghl-install';
  if (!signed && state !== '') {
    // A state we cannot read. Not necessarily an attack — GoHighLevel may send
    // its own — so it is logged rather than refused, and the session still has
    // to be there.
    console.warn('[ghl-oauth] install callback carried a state we did not sign');
  }

  const access = await currentAccess();
  const contractor = access.ok && access.access.role === 'contractor';
  if (!signed && !contractor) {
    // Neither gate. A signed state proves the flow began at our own /connect
    // page; a contractor session proves who is asking. One or the other, and
    // never neither — otherwise the one-time code would be spent for anybody
    // who happened to arrive with one.
    return page(
      'Sign in first',
      '<p>Open the Hub from GoHighLevel, then start the install again.</p>',
      403,
    );
  }

  const oauth = readOauthConfig();
  if (!oauth.configured) {
    return page(
      'The app is not configured here',
      `<p>Missing: ${escapeHtml(oauth.missing.join(', '))}.</p>`,
      503,
    );
  }

  const hub = getHubGhlOauth();
  if (!hub.available) {
    return page(
      'The Hub database is not available',
      `<p>Nothing was stored. Missing: ${escapeHtml(hub.missing.join(', '))}.</p>`,
      503,
    );
  }

  const tokens = await exchangeCode(oauth.config, code);
  if (tokens === null) {
    return page(
      'GoHighLevel would not complete the install',
      '<p>The code could not be exchanged. The reason is in the server log; the most common cause is a redirect URL that does not match the one on the app.</p>',
      502,
    );
  }

  // The whole install hangs on which sub-account this is for. GoHighLevel names
  // it in the token response; without a real one there is nothing to key the
  // row on, and guessing — from the installer's session, say — would file one
  // contractor's credential under another's location.
  if (!isGhlLocationId(tokens.locationId)) {
    return page(
      'GoHighLevel did not say which sub-account this is',
      '<p>The install came back without a location id, so there is nothing to file it under. Nothing was stored. Check the app is installed on a sub-account rather than at agency level.</p>',
      502,
    );
  }

  const stored = await hub.store.save({
    locationId: tokens.locationId,
    companyId: tokens.companyId === '' ? null : tokens.companyId,
    clientId: oauth.config.clientId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes === '' ? null : tokens.scopes,
    installedBy: installerName(contractor ? access : null, signed),
  });

  if (!stored) {
    return page(
      'Nowhere to store the install',
      '<p>Migration <code>0016_ghl_oauth_tokens.sql</code> has not been run on this database. Run it and install again — nothing was kept.</p>',
      503,
    );
  }

  // A previous install's cached token for this sub-account is worthless now.
  resetLocationTokens();
  resetResolvedConfig();

  const connected = await hub.store.connectedLocations(oauth.config.clientId).catch(() => []);
  const others =
    connected.length > 1
      ? `<p>${connected.length} sub-accounts are now connected.</p>`
      : '';

  // Somebody who arrived here through onboarding has never seen the Hub. Give
  // them the door rather than a full stop.
  const open = `<p style="margin-top:1.5rem"><a href="/auth/ghl?locationId=${escapeHtml(tokens.locationId)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open Project Hub</a></p>`;

  return page(
    'Connected',
    `<p>Sub-account <code>${escapeHtml(tokens.locationId)}</code> is connected.</p>${others}${open}`,
    200,
  );
}

/** For the trail: who installed it, and which route they came through. */
function installerName(
  access: Awaited<ReturnType<typeof currentAccess>> | null,
  signed: boolean,
): string {
  const who = access !== null && access.ok ? access.access.session.name : 'someone not signed in';
  return signed ? who : `${who} (from the App Marketplace)`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
