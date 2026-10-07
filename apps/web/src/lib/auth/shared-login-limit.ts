import 'server-only';

import { createHmac } from 'node:crypto';
import { readHubConfig, type HubConfig } from '../hub-db/client.ts';
import { resolveSessionSecret } from './session-crypto.ts';
import {
  createRateLimiter, CLIENT_CODE_LIMIT, PASSWORD_SIGN_IN_LIMIT,
  type SignInAttemptLimiter, type RateLimitDecision,
} from './rate-limit.ts';

export type LoginLimitKind = 'code' | 'password';

export function createSharedLoginLimiter(
  kind: LoginLimitKind,
  config: () => HubConfig,
  secret: () => string,
  fetchImpl: typeof fetch = fetch,
): SignInAttemptLimiter {
  return {
    async consume(keys) {
      const unique = [...new Set(keys.filter(Boolean))];
      if (unique.length < 1 || unique.length > 2) throw new Error('Login limit keys unavailable');
      const hub = config();
      // Keyed hashes avoid storing raw emails/IPs or cheap dictionary hashes.
      const salt = secret();
      const hashes = unique.map(key => createHmac('sha256', salt)
        .update(`hub-login-limit:v1:${kind}:${key}`).digest('hex')).sort();
      const response = await fetchImpl(hub.url + '/rest/v1/rpc/hub_consume_login_attempt', {
        method: 'POST',
        headers: { apikey: hub.key, Authorization: `Bearer ${hub.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_kind: kind, p_keys: hashes }),
        signal: AbortSignal.timeout(5000),
      });
      // No retry or memory fallback: an uncertain write may have counted already.
      if (!response.ok) throw new Error('Shared login limits unavailable');
      const value: unknown = await response.json();
      if (typeof value !== 'object' || value === null || !('allowed' in value) ||
          typeof value.allowed !== 'boolean' || !('retryAfterSeconds' in value) ||
          typeof value.retryAfterSeconds !== 'number' ||
          !Number.isSafeInteger(value.retryAfterSeconds) || value.retryAfterSeconds < 0 ||
          (value.allowed ? value.retryAfterSeconds !== 0 : value.retryAfterSeconds < 1)) {
        throw new Error('Shared login limit response invalid');
      }
      return value as RateLimitDecision;
    },
    reset() {
      // Keep all attempts until expiry. A valid login must not refund the
      // shared IP budget used to attack other accounts, or race another claim.
    },
  };
}

/** Production and Vercel previews fail closed until migration 0022 is installed. */
export function serverLoginLimiter(kind: LoginLimitKind): SignInAttemptLimiter {
  if (process.env.NODE_ENV !== 'production') {
    return createRateLimiter(kind === 'code' ? CLIENT_CODE_LIMIT : PASSWORD_SIGN_IN_LIMIT);
  }
  return createSharedLoginLimiter(kind, () => {
    const result = readHubConfig();
    if (!result.configured) throw new Error('Shared login limits unavailable');
    return result.config;
  }, resolveSessionSecret);
}
