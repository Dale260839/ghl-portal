import { NextResponse } from 'next/server';

import { getSession } from '@/lib/session';

/**
 * Which role this browser is signed in as — and nothing else.
 *
 * For the error page (`components/friendly-error.tsx`), which asks before
 * blaming the database: a screen opened as the contractor fails every save once
 * the same browser has signed in as a crew member or homeowner, and that needs
 * saying as what it is. No name, email, tenant or project: the only thing the
 * page needs is whether the role still matches the screen.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  return NextResponse.json(
    { role: session?.role ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
