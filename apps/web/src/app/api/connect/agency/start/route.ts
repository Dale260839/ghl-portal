import { NextResponse, type NextRequest } from 'next/server';

import { currentAccess } from '@/lib/access';
import { agencyAuthorizeUrl, readAgencyConfig } from '@/lib/ghl/oauth-config';
import { sign } from '@/lib/auth/session-crypto';

/**
 * Installing the AGENCY app — the one that lets every contractor sign in.
 *
 * ---------------------------------------------------------------------------
 * THIS ONE IS DIFFERENT, AND IT IS GATED DIFFERENTLY
 *
 * The sub-account install is routine: a contractor connecting their own
 * account, started automatically, with GoHighLevel's approval screen as the
 * authority. This is not that. It is done once, by whoever runs the agency, and
 * what it stores can read every sub-account in the agency.
 *
 * So it requires a signed-in contractor and always will. There is no bootstrap
 * problem to excuse: whoever installs this can already reach the Hub — the
 * whole point of the install is to help the contractors who cannot.
 * ---------------------------------------------------------------------------
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const access = await currentAccess();
  if (!access.ok || access.access.role !== 'contractor') {
    return NextResponse.json(
      { error: 'Sign in from GoHighLevel first — the agency install is not a self-service step.' },
      { status: 403 },
    );
  }

  const agency = readAgencyConfig();
  if (!agency.configured) {
    return NextResponse.json(
      { error: 'The agency app is not configured on this deployment.', missing: agency.missing },
      { status: 503 },
    );
  }

  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) {
    return NextResponse.json({ error: 'SESSION_SECRET is not set here.' }, { status: 503 });
  }

  const state = sign({ purpose: 'ghl-agency-install', by: access.access.session.name }, secret, {
    ttlSeconds: 600,
  });

  return NextResponse.redirect(agencyAuthorizeUrl(agency.config, state), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
