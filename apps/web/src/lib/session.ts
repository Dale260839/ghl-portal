import 'server-only';

import { cookies } from 'next/headers';

import { resolveSessionSecret, sign, verify } from './auth/session-crypto.ts';
import type { Role, Session } from './demo-accounts.ts';

/**
 * DEMO AUTHENTICATION — placeholder, not a security boundary.
 *
 * Real auth is GHL portal login (§9.2), which is blocked on the integration
 * token and on confirming how a portal-authenticated contact is identified
 * server-side (see docs/PHASE-0.md §3). This module exists so the screens can
 * be built and demoed now; it is deliberately shaped like the real thing —
 * server-side session lookup, role, and an associated contact — so swapping in
 * GHL auth touches this file and nothing else.
 *
 * §9.2 still holds even here: the role determines which surfaces render, and
 * the client surfaces resolve their projects from the session's contact rather
 * than from anything supplied by the browser.
 *
 * The session *shape* and the demo identities live in `demo-accounts.ts`, which
 * carries no `server-only` marker so pure modules and tests can use them. This
 * file re-exports them, so nothing else needs to know about the split.
 */

export type { DemoAccount, Role, Session } from './demo-accounts.ts';
export { DEMO_ACCOUNTS, accountForEmail, homeFor } from './demo-accounts.ts';

const COOKIE = 'bs_session_hub';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const result = verify<Session>(raw, resolveSessionSecret());
  if (!result.valid) return null;

  const { role } = result.payload;
  if (!isRole(role)) return null;
  return result.payload;
}

function isRole(value: unknown): value is Role {
  return value === 'contractor' || value === 'field' || value === 'client';
}

export async function setSession(session: Session): Promise<void> {
  const token = sign({ ...session }, resolveSessionSecret(), { ttlSeconds: SESSION_TTL_SECONDS });
  (await cookies()).set(COOKIE, token, {
    // Signed, so tampering is detectable — but still httpOnly and, in
    // production, Secure. Defence in depth: the signature is the guarantee,
    // these reduce how often it has to be relied on.
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
