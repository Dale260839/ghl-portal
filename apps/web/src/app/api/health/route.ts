import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { isAdminSession } from '@/lib/admin-access';
import { healthReport } from '@/lib/health';

/**
 * The same facts as the Health screen, as JSON.
 *
 * ---------------------------------------------------------------------------
 * WHO MAY ASK
 *
 * An operator session, or something holding `CRON_SECRET` — so a deploy can be
 * checked in one request without a browser, which is the point of having it.
 *
 * **Not open.** A public health endpoint here would publish which migrations
 * have landed, whether email is on, and whether the demo door is open. That is
 * a map of where to push, handed out for free. The answer to an unauthorised
 * caller is 404, not 401: a 401 confirms the route exists.
 *
 * It never writes, and never reports a project, a client or a figure. See
 * `lib/health.ts` for what it will and will not say.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

function authorised(request: NextRequest, admin: boolean): boolean {
  if (admin) return true;

  const expected = (process.env.CRON_SECRET ?? '').trim();
  if (expected === '') return false;

  const header = request.headers.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  // Length-checked before comparing, and compared in full: a prefix match would
  // let somebody find the secret one character at a time.
  return bearer.length === expected.length && bearer === expected;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = isAdminSession(await getSession());
  if (!authorised(request, admin)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const report = await healthReport();
  return NextResponse.json(report, {
    // A monitor can alert on the status code alone, without parsing anything.
    status: report.state === 'fail' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
