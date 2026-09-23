import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { authorizeUrl, readOauthConfig } from '@/lib/ghl/oauth-config';
import { sign } from '@/lib/auth/session-crypto';
import { isGhlLocationId } from '@/lib/ghl/config';

/**
 * Step one of connecting a sub-account: send whoever is installing to
 * GoHighLevel to approve it, and let them pick the sub-account.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY START AN INSTALL
 *
 * A signed-in contractor, and nobody else. The install writes that
 * sub-account's refresh token into the Hub — full API access to a contractor's
 * CRM — so an anonymous visitor finding this URL must not be able to begin the
 * flow, let alone replace a working install with one of their own.
 *
 * The `state` is a signed token rather than a random string in a cookie: the
 * callback can then prove the flow started here, with the same HMAC that
 * protects sessions, without needing anywhere to remember it. Ten minutes is
 * plenty for a person to click Approve, and short enough that a copied URL is
 * worthless by the time it is found.
 * ---------------------------------------------------------------------------
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  // A session is recorded when there is one, and not required when there is
  // not. A contractor who has never connected CANNOT have one — proving their
  // sub-account needs a credential for it, which is the thing they are here to
  // provide. Demanding a session would make this reachable only by people who
  // do not need it.
  //
  // What stands in its place is GoHighLevel's own approval screen: only
  // somebody with access to that sub-account can complete it. Anyone else gets
  // as far as a row for a sub-account they already control, which is worth
  // nothing to them.
  const access = await currentAccess();
  const by = access.ok && access.access.role === 'contractor' ? access.access.session.name : null;

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

  // The location the visitor arrived with, carried through so the page they
  // land on afterwards can offer to open the Hub. A claim, never a permission:
  // what is actually connected is whatever GoHighLevel names in the response.
  const claimed = request.nextUrl.searchParams.get('locationId') ?? '';

  const state = sign(
    {
      purpose: 'ghl-install',
      by,
      ...(isGhlLocationId(claimed) ? { locationId: claimed.trim() } : {}),
    },
    secret,
    { ttlSeconds: 600 },
  );

  return NextResponse.redirect(authorizeUrl(oauth.config, state), {
    // Never cached: the state inside expires, and a cached redirect would send
    // the next person to an authorisation URL that is already dead.
    headers: { 'Cache-Control': 'no-store' },
  });
}
