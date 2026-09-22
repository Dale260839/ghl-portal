import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { authorizeUrl, readOauthConfig } from '@/lib/ghl/oauth-config';
import { sign } from '@/lib/auth/session-crypto';

/**
 * Step one of installing the agency Marketplace app: send the agency owner to
 * GoHighLevel to approve it.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY START AN INSTALL
 *
 * A signed-in contractor, and nobody else. The install writes the agency's
 * refresh token into the Hub — the single most powerful credential this system
 * holds — so an anonymous visitor finding this URL must not be able to begin
 * the flow, let alone replace a working install with one of their own.
 *
 * The `state` is a signed token rather than a random string in a cookie: the
 * callback can then prove the flow started here, with the same HMAC that
 * protects sessions, without needing anywhere to remember it. Ten minutes is
 * plenty for a person to click Approve, and short enough that a copied URL is
 * worthless by the time it is found.
 * ---------------------------------------------------------------------------
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const access = await currentAccess();
  if (!access.ok || access.access.role !== 'contractor') {
    return NextResponse.json(
      { error: 'Sign in from GoHighLevel first — only a contractor can install the app.' },
      { status: 403 },
    );
  }

  const oauth = readOauthConfig();
  if (!oauth.configured) {
    return NextResponse.json(
      {
        error: 'The Marketplace app is not configured on this deployment.',
        missing: oauth.missing,
      },
      { status: 503 },
    );
  }

  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    // Without this the state cannot be signed, and an unsigned state is no
    // state at all. Refuse rather than proceed with a decorative one.
    return NextResponse.json({ error: 'SESSION_SECRET is not set here.' }, { status: 503 });
  }

  const state = sign(
    { purpose: 'ghl-install', by: access.access.session.name },
    secret,
    { ttlSeconds: 600 },
  );

  return NextResponse.redirect(authorizeUrl(oauth.config, state), {
    // Never cached: the state inside expires, and a cached redirect would send
    // the next person to an authorisation URL that is already dead.
    headers: { 'Cache-Control': 'no-store' },
  });
}
