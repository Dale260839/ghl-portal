import { NextRequest, NextResponse } from 'next/server';

import { clearSession } from '@/lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Embedded sessions use SameSite=None, so cookie policy alone cannot prevent CSRF.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Invalid origin' }, {
      status: 403, headers: { 'Cache-Control': 'no-store' },
    });
  }

  await clearSession();
  const response = NextResponse.redirect(new URL('/', request.nextUrl.origin), 303);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
