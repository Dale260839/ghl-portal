/**
 * Attempt limiting for the client sign-in front door.
 *
 * Why this exists: project codes are SEQUENTIAL (`BSA-044`, `BSA-045`,
 * `BSA-046`), so anyone holding a homeowner's email address can walk the code
 * space a few dozen guesses at a time. The lookup already mints nothing on its
 * own (`client-lookup.ts`) and the emailed token is the only credential
 * (`verification-token.ts`), so a successful guess does not hand over an
 * account. But an unlimited lookup still lets an attacker confirm *which*
 * project belongs to an email, and it sprays real sign-in emails at a real
 * homeowner. Both are worth refusing.
 *
 * Two keys are counted per request and either one can refuse it:
 *
 *   - the email, which is the constant an enumerator holds while it varies the
 *     code, so this is the counter that actually stops the walk;
 *   - the caller's IP, so the same walk spread across many emails is also
 *     capped.
 *
 * Fixed window rather than a sliding log: it is a handful of integers, it
 * cannot be gamed into unbounded memory, and the failure mode (a burst allowed
 * at a window boundary) is harmless at these limits.
 *
 * PROVISIONAL — in-memory, so counters reset on restart and are not shared
 * across serverless instances, exactly like `createMemoryConsumedTokens`.
 * Correct for a single instance; production swaps the store for a row keyed by
 * `key` (a `hub_*` table) behind the same interface, and no caller changes.
 */

export interface RateLimitConfig {
  /** Attempts permitted inside one window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

/** Requesting a sign-in link. Tight, because a real homeowner does this once. */
export const SIGN_IN_REQUEST_LIMIT: RateLimitConfig = { limit: 5, windowSeconds: 15 * 60 };

/**
 * Presenting a token at `/auth/verify`. Looser, because a real link is clicked
 * once but may be retried, and forging a signed token is not a guessing game.
 */
export const VERIFY_LIMIT: RateLimitConfig = { limit: 20, windowSeconds: 15 * 60 };

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds until the offending window resets. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

interface Window {
  count: number;
  /** Unix seconds at which this window resets. */
  resetsAt: number;
}

export interface RateLimiter {
  /**
   * Counts one attempt against every key and returns the strictest decision.
   *
   * Counting happens even when a key is already over its limit, so hammering
   * does not let the window drain early. Keys are counted as given; the caller
   * decides what a key means (see `signInRequestKeys`).
   */
  consume(keys: readonly string[], options?: { now?: number }): RateLimitDecision;
  /** Clears a key's window. For the success path and for tests. */
  reset(key: string): void;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0 };

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const windows = new Map<string, Window>();

  /** Drops windows that have already reset, so the map cannot grow forever. */
  function evictExpired(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetsAt <= now) windows.delete(key);
    }
  }

  return {
    consume(keys, options = {}) {
      const now = options.now ?? Math.floor(Date.now() / 1000);
      evictExpired(now);

      let worst = 0;
      for (const key of keys) {
        if (key === '') continue;
        const existing = windows.get(key);
        const window: Window =
          existing === undefined || existing.resetsAt <= now
            ? { count: 0, resetsAt: now + config.windowSeconds }
            : existing;

        window.count += 1;
        windows.set(key, window);

        if (window.count > config.limit) {
          worst = Math.max(worst, window.resetsAt - now);
        }
      }

      return worst === 0 ? ALLOWED : { allowed: false, retryAfterSeconds: worst };
    },

    reset(key) {
      windows.delete(key);
    },
  };
}

/**
 * The keys one sign-in request is counted against.
 *
 * Email is normalized the same way `locateClient` normalizes it, so casing or
 * padding cannot buy extra attempts. The project code is deliberately NOT part
 * of any key: it is the value being guessed, so including it would give every
 * guess its own fresh counter and defeat the whole limit.
 */
export function signInRequestKeys(email: string, ip: string): readonly string[] {
  const keys: string[] = [];
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail !== '') keys.push(`signin:email:${normalizedEmail}`);
  if (ip !== '') keys.push(`signin:ip:${ip}`);
  return keys;
}

/** The key a token presentation is counted against. Only the caller's IP. */
export function verifyKeys(ip: string): readonly string[] {
  return ip === '' ? [] : [`verify:ip:${ip}`];
}

/**
 * Best-effort client IP from proxy headers.
 *
 * Vercel sets `x-forwarded-for` as a comma-separated chain whose first entry is
 * the original client. An absent or unparseable header returns `''`, which
 * yields no IP key — the email key still applies, so a request is never
 * un-limited on the counter that matters.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim() !== '') {
    const first = forwarded.split(',')[0]?.trim() ?? '';
    if (first !== '') return first;
  }
  return headers.get('x-real-ip')?.trim() ?? '';
}
