import { randomBytes } from 'node:crypto';

import { sign, verify } from './session-crypto.ts';

/**
 * Client verification tokens — the magic link that authenticates a homeowner.
 *
 * C-2 (SOURCE-OF-TRUTH): email + project ID *locate* a record; this emailed
 * token is what *authenticates*. It is single-use, time-limited and signed —
 * and it is never the project ID. Possession of an email and a project ID mints
 * nothing on its own (`client-lookup.ts`); only a valid token here does. That is
 * exactly the reconciliation D3 §6 and D1 require of D4 §5.
 *
 * Signed with the same secret as the session cookie, but the two can never be
 * confused: a session carries a `role` and no `purpose`; this carries
 * `purpose: 'client-verify'` and no `role`, and each path checks for its own. A
 * session cookie handed to `consumeVerificationToken` fails the purpose check;
 * a verification token handed to `getSession` fails the role check.
 */

export const CLIENT_VERIFY_PURPOSE = 'client-verify';

/** Short by design — a login link that lingers is a standing credential. */
export const VERIFICATION_TTL_SECONDS = 15 * 60;

export interface VerificationInput {
  contactId: string;
  email: string;
}

/** A fresh single-use id. Recorded on consume so a replay is refused. */
export function newJti(): string {
  return randomBytes(16).toString('base64url');
}

export function issueVerificationToken(
  input: VerificationInput,
  secret: string,
  options: { ttlSeconds?: number; now?: number; jti?: string } = {},
): string {
  return sign(
    {
      purpose: CLIENT_VERIFY_PURPOSE,
      contactId: input.contactId,
      email: input.email.trim().toLowerCase(),
      jti: options.jti ?? newJti(),
    },
    secret,
    { ttlSeconds: options.ttlSeconds ?? VERIFICATION_TTL_SECONDS, now: options.now },
  );
}

/**
 * Records the token ids already spent, so a link works exactly once.
 *
 * PROVISIONAL — in-memory, so it resets on restart and is not shared across
 * serverless instances. Correct for the demo and a single instance; production
 * swaps this for a row keyed by `jti` (a `hub_*` table) behind the same
 * interface, and nothing else changes.
 */
export interface ConsumedTokens {
  has(jti: string): boolean;
  add(jti: string): void;
}

export function createMemoryConsumedTokens(): ConsumedTokens {
  const spent = new Set<string>();
  return {
    has: (jti) => spent.has(jti),
    add: (jti) => {
      spent.add(jti);
    },
  };
}

export type VerificationOutcome =
  | { valid: true; contactId: string; email: string }
  | { valid: false; reason: 'invalid' | 'expired' | 'wrong_purpose' | 'already_used' };

/**
 * Verifies a link and spends it. On success the `jti` is recorded, so the very
 * next call with the same token returns `already_used`.
 *
 * Order matters: signature and expiry first (in `verify`), then purpose, then
 * single-use. An attacker-controlled string is never trusted before its
 * signature is checked.
 */
export function consumeVerificationToken(
  token: string | undefined | null,
  secret: string,
  store: ConsumedTokens,
  options: { now?: number } = {},
): VerificationOutcome {
  const result = verify(token, secret, { now: options.now });
  if (!result.valid) {
    return { valid: false, reason: result.reason === 'expired' ? 'expired' : 'invalid' };
  }

  const { purpose, contactId, email, jti } = result.payload;
  if (purpose !== CLIENT_VERIFY_PURPOSE) return { valid: false, reason: 'wrong_purpose' };
  if (typeof contactId !== 'string' || contactId === '') return { valid: false, reason: 'invalid' };
  if (typeof jti !== 'string' || jti === '') return { valid: false, reason: 'invalid' };
  if (store.has(jti)) return { valid: false, reason: 'already_used' };

  store.add(jti);
  return { valid: true, contactId, email: typeof email === 'string' ? email : '' };
}
