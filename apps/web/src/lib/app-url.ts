import 'server-only';

import { headers } from 'next/headers';

/**
 * Where this app is actually running.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST `NEXT_PUBLIC_APP_URL`
 *
 * It was, and it emailed somebody a `http://localhost:3000` invitation link from
 * the deployed site. The variable is set in `.env.local` for development and
 * nothing overrode it in production, so every link the server generated pointed
 * at a machine the recipient does not have.
 *
 * A link that goes into somebody else's inbox has to be right the first time —
 * there is no "reload and it works". So this asks the REQUEST what host it came
 * in on, which is correct by construction on any deployment, and falls back to
 * the variable only when there is no request to ask.
 * ---------------------------------------------------------------------------
 *
 * `x-forwarded-*` come from the proxy in front of the app, which on Vercel is
 * Vercel. They are trustworthy there in a way they would not be on a server
 * exposed directly to the internet — worth knowing if this ever moves.
 */
export async function appUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (host !== null && host.trim() !== '') {
      const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
      return `${proto}://${host}`.replace(/\/+$/, '');
    }
  } catch {
    // Outside a request — a script, a test, a build step. The env var is the
    // only answer available, and it is the right one there.
  }

  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return (configured === undefined || configured.trim() === ''
    ? 'http://localhost:3000'
    : configured
  ).replace(/\/+$/, '');
}
