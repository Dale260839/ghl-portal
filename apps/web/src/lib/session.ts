import 'server-only';

import { cookies } from 'next/headers';

import { resolveSessionSecret, sign, verify, type SignedPayload } from './auth/session-crypto.ts';
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

export async function getSession(): Promise<(Session & SignedPayload) | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  const result = verify<Session>(raw, resolveSessionSecret());
  if (!result.valid) return null;

  const { role } = result.payload;
  if (!isRole(role)) return null;
  // Expire cookies minted by the former unsigned menu-link login.
  const identity = result.payload.returnTo ?? result.payload;
  if (process.env.NODE_ENV === 'production' && identity.ghlLocationId &&
      !result.payload.membershipId && identity.ghlIdentityVerified !== true) return null;
  return result.payload;
}

function isRole(value: unknown): value is Role {
  return value === 'contractor' || value === 'field' || value === 'client';
}

export async function setSession(session: Session, options: { expiresAt?: number } = {}): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = options.expiresAt === undefined ? SESSION_TTL_SECONDS : options.expiresAt - now;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > SESSION_TTL_SECONDS) {
    throw new Error('Invalid session lifetime');
  }
  const token = sign({ ...session }, resolveSessionSecret(), { now, ttlSeconds });
  const embedded = process.env.NODE_ENV === 'production' && session.ghlEmbedded === true;
  (await cookies()).set(COOKIE, token, {
    // Signed, so tampering is detectable — but still httpOnly and, in
    // production, Secure. Defence in depth: the signature is the guarantee,
    // these reduce how often it has to be relied on.
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: embedded ? 'none' : 'lax',
    partitioned: embedded,
    path: '/',
    maxAge: ttlSeconds,
  });
}

export async function clearSession(): Promise<void> {
  const raw = (await cookies()).get(COOKIE)?.value;
  // Signature-checked metadata only: expiry must not stop deletion of a CHIPS cookie.
  // This result is never used to authenticate a request.
  const reading = verify<Session>(raw, resolveSessionSecret(), { now: 0 });
  const embedded = process.env.NODE_ENV === 'production' && reading.valid && reading.payload.ghlEmbedded === true;
  (await cookies()).set(COOKIE, '', {
    maxAge: 0, path: '/', httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: embedded ? 'none' : 'lax', partitioned: embedded,
  });
}
