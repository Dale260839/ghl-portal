import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * Signed session tokens.
 *
 * The demo session was plaintext JSON in a cookie. `httpOnly` stops a page
 * script reading it, but it does nothing about the person holding the browser —
 * anyone could edit `authProfileId` in devtools and read another contractor's
 * projects. Now that tenancy is enforced *from the session* (D-012), the session
 * has to be unforgeable or the tenancy is decorative.
 *
 * Format: `v1.<base64url payload>.<base64url hmac>` — versioned so the scheme can
 * change without every existing cookie becoming a crash instead of a logout.
 */

const VERSION = 'v1';
const DEFAULT_TTL_SECONDS = 60 * 60 * 8;

export interface SignedPayload {
  /** Issued at, epoch seconds. */
  iat: number;
  /** Expires at, epoch seconds. */
  exp: number;
  [key: string]: unknown;
}

export type VerifyFailure =
  | 'malformed'
  | 'unsupported_version'
  | 'bad_signature'
  | 'expired'
  | 'unparseable';

export type VerifyResult<T> =
  | { valid: true; payload: T & SignedPayload }
  | { valid: false; reason: VerifyFailure };

function b64url(input: Buffer): string {
  return input.toString('base64url');
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length —
 * so unequal lengths short-circuit to false before it's called.
 */
function signaturesMatch(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function sign(
  claims: Record<string, unknown>,
  secret: string,
  options: { ttlSeconds?: number; now?: number } = {},
): string {
  if (secret.length < 32) {
    // A short secret is worse than an obvious absence: it looks configured.
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const payload: SignedPayload = {
    ...claims,
    iat: now,
    exp: now + (options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const encoded = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const signature = b64url(hmac(secret, `${VERSION}.${encoded}`));
  return `${VERSION}.${encoded}.${signature}`;
}

export function verify<T = Record<string, unknown>>(
  token: string | undefined | null,
  secret: string,
  options: { now?: number } = {},
): VerifyResult<T> {
  if (typeof token !== 'string' || token === '') return { valid: false, reason: 'malformed' };

  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  const [version, encoded, signature] = parts as [string, string, string];
  if (version !== VERSION) return { valid: false, reason: 'unsupported_version' };

  // Signature first, always. Parsing attacker-controlled JSON before deciding
  // whether to trust it is how a session bug becomes a parser bug.
  const expected = hmac(secret, `${version}.${encoded}`);
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return { valid: false, reason: 'bad_signature' };
  }
  if (!signaturesMatch(expected, provided)) return { valid: false, reason: 'bad_signature' };

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPayload;
  } catch {
    return { valid: false, reason: 'unparseable' };
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload: payload as T & SignedPayload };
}

/** For generating a secret: `node -e "...".` Also used by the dev fallback. */
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

let devSecret: string | null = null;

/**
 * Resolves the signing secret.
 *
 * In production a missing secret is fatal — signing with a generated one would
 * mean every deploy silently logs everyone out, and worse, that nobody notices
 * the secret was never configured.
 *
 * In development it generates one per process, so `npm run dev` works with no
 * setup and sessions simply don't survive a restart.
 */
export function resolveSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SESSION_SECRET;
  if (typeof configured === 'string' && configured.length >= 32) return configured;

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SESSION_SECRET is missing or too short. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }

  if (devSecret === null) {
    devSecret = generateSecret();
    console.warn('[auth] No SESSION_SECRET set — using a per-process development secret.');
  }
  return devSecret;
}
