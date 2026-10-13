import { NextRequest, NextResponse } from 'next/server';
import { currentAccess } from '@/lib/access';
import { getSession, setSession } from '@/lib/session';
import { getHubClient } from '@/lib/hub-db/client';
import { BrowserHandoffs, canOpenWorkspace } from '@/lib/auth/browser-handoff';
import { resolveSessionSecret } from '@/lib/auth/session-crypto';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get('origin') !== request.nextUrl.origin) return reply({ error: 'Invalid origin' }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({ error: 'Invalid request' }, 400);
  let input: { action?: unknown; token?: unknown };
  try {
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: 'Invalid request' }, 400);
    const decoder = new TextDecoder();
    let raw = '', bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 256) { await reader.cancel(); return reply({ error: 'Invalid request' }, 400); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    input = JSON.parse(raw);
    if (!input || typeof input !== 'object') return reply({ error: 'Invalid request' }, 400);
  } catch { return reply({ error: 'Invalid request' }, 400); }
  const hub = getHubClient();
  if (!hub.available) return reply({ error: 'Project Hub could not connect. Please try again shortly.' }, 503);
  try {
    const handoffs = new BrowserHandoffs(hub.client, resolveSessionSecret());
    if (input.action === 'issue') {
      const access = await currentAccess();
      const session = await getSession();
      if (!access.ok || access.access.role !== 'contractor' || session === null || !canOpenWorkspace(session)) return reply({ error: 'Sign in from GoHighLevel first.' }, 401);
      return reply(await handoffs.issue(session));
    }
    if (input.action !== 'redeem' || typeof input.token !== 'string') return reply({ error: 'Invalid request' }, 400);
    const result = await handoffs.redeem(input.token);
    if (result === null) return reply({ error: 'This opening link expired or was already used. Open Project Hub from GoHighLevel again.' }, 401);
    await setSession(result.session, { expiresAt: result.expiresAt });
    return reply({ redirectTo: '/dashboard' });
  } catch {
    // Never log the request body, one-time link, or stored session token.
    return reply({ error: 'Project Hub could not open your workspace. Return to GoHighLevel and try again.' }, 503);
  }
}
