import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The GHL Custom Menu Link landing (D-011).
 *
 * A user already signed in to GoHighLevel clicks our menu item; GHL opens our
 * callback with merge fields in the query string. We turn that into a session.
 *
 * **The security problem, stated plainly.** Merge-field query parameters are not
 * authentication. They arrive as clear text in a URL, so anyone who learns the
 * callback address can request it with a `locationId` they invented. Minting a
 * session straight from them would hand any stranger a contractor's data — and
 * because tenancy now comes from the session (D-012), it would hand them a
 * specific contractor's data of their choosing.
 *
 * So the landing is only trusted when it is *proven*, by one of:
 *
 *   1. **A signature** — GHL appends an HMAC we can check against a shared
 *      secret. Cheapest, works with a plain menu link.
 *   2. **API verification** — we call GHL with our own credential and confirm
 *      the user and location exist and are related. Slower, no shared secret.
 *
 * In production, an unproven landing is refused. In development it can be
 * allowed explicitly, because otherwise nobody can work on the flow before the
 * menu link exists — but it is opt-in, loud, and never the default.
 */

export interface LandingParams {
  locationId?: string;
  userId?: string;
  email?: string;
  /** HMAC over the other params, when GHL is configured to send one. */
  signature?: string;
  /** Unix seconds, when sent. Bounds how long a captured URL stays usable. */
  timestamp?: string;
}

export interface LandingPolicy {
  /** Shared secret for signature mode. Absent disables that mode. */
  signingSecret?: string;
  /** Set only in development. Accepts unproven landings. */
  allowUnverified?: boolean;
  /** How old a signed landing may be. Defaults to 5 minutes. */
  maxAgeSeconds?: number;
  now?: number;
}

export type LandingRejection =
  | 'missing_location'
  | 'missing_user'
  | 'unsigned'
  | 'bad_signature'
  | 'stale'
  | 'not_configured';

export type LandingResult =
  | {
      ok: true;
      locationId: string;
      userId: string;
      email: string | null;
      /** How the landing was proven — worth logging. */
      proof: 'signature' | 'unverified_development';
    }
  | { ok: false; reason: LandingRejection };

/** The params covered by the signature, in a fixed order so both sides agree. */
const SIGNED_FIELDS = ['locationId', 'userId', 'email', 'timestamp'] as const;

export function canonicalString(params: LandingParams): string {
  return SIGNED_FIELDS.map((field) => `${field}=${params[field] ?? ''}`).join('&');
}

export function signLanding(params: LandingParams, secret: string): string {
  return createHmac('sha256', secret).update(canonicalString(params)).digest('base64url');
}

function signatureMatches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyLanding(params: LandingParams, policy: LandingPolicy): LandingResult {
  const locationId = params.locationId?.trim() ?? '';
  const userId = params.userId?.trim() ?? '';

  // Identity first — a landing that can't say who or where is not worth
  // verifying, and reporting that separately makes a misconfigured menu link
  // obvious instead of looking like a signature problem.
  if (locationId === '') return { ok: false, reason: 'missing_location' };
  if (userId === '') return { ok: false, reason: 'missing_user' };

  if (policy.signingSecret !== undefined && policy.signingSecret !== '') {
    if (params.signature === undefined || params.signature === '') {
      return { ok: false, reason: 'unsigned' };
    }
    if (!signatureMatches(signLanding(params, policy.signingSecret), params.signature)) {
      return { ok: false, reason: 'bad_signature' };
    }

    // A valid signature is forever unless it's bounded. Without this, a URL
    // captured from a browser history or a shared screenshot is a permanent
    // key to that contractor's account.
    if (params.timestamp !== undefined && params.timestamp !== '') {
      const issued = Number(params.timestamp);
      const now = policy.now ?? Math.floor(Date.now() / 1000);
      const maxAge = policy.maxAgeSeconds ?? 300;
      if (!Number.isFinite(issued) || Math.abs(now - issued) > maxAge) {
        return { ok: false, reason: 'stale' };
      }
    }

    return {
      ok: true,
      locationId,
      userId,
      email: params.email?.trim() || null,
      proof: 'signature',
    };
  }

  if (policy.allowUnverified === true) {
    return {
      ok: true,
      locationId,
      userId,
      email: params.email?.trim() || null,
      proof: 'unverified_development',
    };
  }

  // No secret and no explicit development opt-in: refuse. Failing to start beats
  // running an auto-login that authenticates nobody.
  return { ok: false, reason: 'not_configured' };
}

/** Human-readable, for the redirect back to sign-in. Never leaks the params. */
export function describeRejection(reason: LandingRejection): string {
  switch (reason) {
    case 'missing_location':
      return 'The link did not identify a sub-account.';
    case 'missing_user':
      return 'The link did not identify a user.';
    case 'unsigned':
      return 'The link was not signed.';
    case 'bad_signature':
      return 'The link signature did not match.';
    case 'stale':
      return 'The link has expired. Open it again from GoHighLevel.';
    case 'not_configured':
      return 'Sign-in from GoHighLevel is not configured yet.';
  }
}
