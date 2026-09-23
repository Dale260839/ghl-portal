import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { verify } from '@/lib/auth/session-crypto';
import { readAgencyConfig, agencyEnabled } from '@/lib/ghl/oauth-config';
import { exchangeAgencyCode, resetAgencyToken } from '@/lib/ghl/agency-token';
import { getHubGhlAgency } from '@/lib/hub-db/ghl-agency';

/**
 * The agency install lands here.
 *
 * Both gates, not either: a signed state AND a contractor session. The
 * sub-account callback relaxes the state because a marketplace-initiated
 * install cannot carry one and because a contractor who has never connected
 * cannot have a session. Neither excuse applies here — this is an agency owner
 * who can already sign in, doing a deliberate one-off — and what it stores
 * reads every sub-account in the agency. The strictest gate available is the
 * right one.
 *
 * It never shows a token, and it does not switch itself on: using the install
 * still takes `GHL_AGENCY_ENABLED=true`, set separately, by someone watching.
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

  const refused = q.get('error');
  if (refused !== null) {
    return page('The install was not approved', `<p>GoHighLevel said: ${escapeHtml(refused)}.</p>`, 400);
  }

  const code = (q.get('code') ?? '').trim();
  const state = (q.get('state') ?? '').trim();
  if (code === '') return page('Nothing to install', '<p>GoHighLevel sent no code.</p>', 400);

  const secret = process.env.SESSION_SECRET ?? '';
  const checked = verify<{ purpose?: unknown }>(state, secret);
  if (!checked.valid || checked.payload.purpose !== 'ghl-agency-install') {
    return page(
      'That install link is not valid any more',
      '<p>Start again from <code>/api/connect/agency/start</code>. Install links are good for ten minutes.</p>',
      400,
    );
  }

  const access = await currentAccess();
  if (!access.ok || access.access.role !== 'contractor') {
    return page('Sign in first', '<p>Open the Hub from GoHighLevel, then start again.</p>', 403);
  }

  const agency = readAgencyConfig();
  if (!agency.configured) {
    return page(
      'The agency app is not configured here',
      `<p>Missing: ${escapeHtml(agency.missing.join(', '))}.</p>`,
      503,
    );
  }

  const hub = getHubGhlAgency();
  if (!hub.available) {
    return page(
      'The Hub database is not available',
      `<p>Nothing was stored. Missing: ${escapeHtml(hub.missing.join(', '))}.</p>`,
      503,
    );
  }

  const tokens = await exchangeAgencyCode(agency.config, code);
  if (tokens === null) {
    return page(
      'GoHighLevel would not complete the install',
      '<p>The code could not be exchanged. The reason is in the server log; the most common cause is a redirect URL that does not match the one on the app.</p>',
      502,
    );
  }

  // A Location install holds one sub-account and cannot read the others, which
  // is the entire reason this app exists. Accepting it would look like success
  // and fix nothing.
  if (tokens.userType !== '' && tokens.userType !== 'Company') {
    return page(
      'That was installed on a single sub-account',
      `<p>This app has to be installed at <strong>agency</strong> level, or it cannot prove the sub-accounts that have installed nothing. Received a <code>${escapeHtml(tokens.userType)}</code> install. Nothing was stored.</p>`,
      400,
    );
  }

  if (tokens.companyId === '') {
    return page(
      'No agency id came back',
      '<p>There is nothing to file the install under. Nothing was stored.</p>',
      502,
    );
  }

  const stored = await hub.store.save({
    companyId: tokens.companyId,
    clientId: agency.config.clientId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes === '' ? null : tokens.scopes,
    installedBy: access.access.session.name,
  });

  if (!stored) {
    return page(
      'Nowhere to store the install',
      '<p>Migration <code>0017_ghl_agency_oauth.sql</code> has not been run on this database. Run it and install again — nothing was kept.</p>',
      503,
    );
  }

  resetAgencyToken();

  const live = agencyEnabled();
  return page(
    'Agency connected',
    `<p>Agency <code>${escapeHtml(tokens.companyId)}</code> is connected.</p>` +
      (live
        ? '<p>Every sub-account in this agency can now be signed in to, including ones that have installed nothing themselves.</p>'
        : '<p>Nothing has changed yet. To start using it, set <code>GHL_AGENCY_ENABLED=true</code> and redeploy.</p>'),
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
