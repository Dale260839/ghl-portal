import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { verify } from '@/lib/auth/session-crypto';
import { readOauthConfig } from '@/lib/ghl/oauth-config';
import { exchangeCode, installedLocations } from '@/lib/ghl/oauth-agency';
import { resetLocationTokens } from '@/lib/ghl/oauth-location';
import { resetResolvedConfig } from '@/lib/ghl/resolve-config';
import { getHubGhlOauth } from '@/lib/hub-db/ghl-oauth';

/**
 * Step two: GoHighLevel returns here with a one-time code, which becomes the
 * agency refresh token.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PAGE MUST NEVER DO
 *
 * Show a token. Not in the HTML, not in an error, not in a log line. Everything
 * below reports counts and ids; the secrets go straight into the database row
 * and are never read back out to a response.
 *
 * WHY IT DOES NOT SWITCH ITSELF ON
 *
 * Completing the install changes nothing about how requests resolve
 * credentials. That still takes `GHL_OAUTH_ENABLED=true`, set deliberately,
 * separately, by a person who is watching. An install that silently redirected
 * every contractor's API calls onto a brand-new path the moment somebody
 * clicked Approve is exactly the kind of change that cannot be undone calmly.
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

  const secret = process.env.SESSION_SECRET ?? '';
  const checked = verify<{ purpose?: unknown }>(state, secret);
  if (!checked.valid || checked.payload.purpose !== 'ghl-install') {
    // Either this did not start at /api/ghl/oauth/start, or it took more than
    // ten minutes. Both are "start again", and neither is worth more detail.
    return page(
      'That install link is not valid any more',
      '<p>Start again from the Hub. Install links are good for ten minutes.</p>',
      400,
    );
  }

  const access = await currentAccess();
  if (!access.ok || access.access.role !== 'contractor') {
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

  // A Location-level install holds a token for ONE sub-account, which is what
  // we already have in the form of Private Integration tokens. Accepting it
  // would look like success and change nothing.
  if (tokens.userType !== '' && tokens.userType !== 'Company') {
    return page(
      'That was installed on a single sub-account',
      `<p>This app has to be installed at <strong>agency</strong> level to serve every contractor. Received a <code>${escapeHtml(tokens.userType)}</code> install. Nothing was stored.</p>`,
      400,
    );
  }

  const companyId = tokens.companyId || oauth.config.companyId;
  if (companyId === '') {
    return page(
      'No agency id came back',
      '<p>Without the company id no sub-account token can be minted. Nothing was stored.</p>',
      502,
    );
  }
  if (oauth.config.companyId !== '' && tokens.companyId !== '' && tokens.companyId !== oauth.config.companyId) {
    return page(
      'That is a different agency',
      '<p>The install came back for an agency other than the one this deployment expects. Nothing was stored.</p>',
      400,
    );
  }

  const stored = await hub.store.save({
    companyId,
    clientId: oauth.config.clientId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.expiresAt,
    installedBy: access.access.session.name,
  });

  if (!stored) {
    return page(
      'Nowhere to store the install',
      '<p>Migration <code>0016_ghl_oauth_tokens.sql</code> has not been run on this database. Run it and install again — nothing was kept.</p>',
      503,
    );
  }

  // A previous install's cached tokens are worthless now.
  resetLocationTokens();
  resetResolvedConfig();

  const locations = await installedLocations(oauth.config, tokens.accessToken, companyId);
  if (locations !== null) await hub.store.saveInstalledLocations(oauth.config.clientId, locations);

  const count =
    locations === null
      ? '<p>The installed sub-account list could not be read, which is only a display detail — set <code>GHL_OAUTH_APP_ID</code> if you want it.</p>'
      : `<p>Installed on <strong>${locations.length}</strong> sub-account${locations.length === 1 ? '' : 's'}.</p>`;

  return page(
    'Installed',
    `${count}<p>Nothing has changed yet for anyone. To start using it, set <code>GHL_OAUTH_ENABLED=true</code> and redeploy. The Private Integration tokens stay as a fallback until you remove them.</p>`,
    200,
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
