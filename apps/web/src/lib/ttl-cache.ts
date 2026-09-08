/**
 * A small per-process memo with a time-to-live and in-flight de-duplication.
 *
 * Why it exists: a contractor navigation on live data was five to seven
 * sequential BuildSuite round-trips, each 300-500ms from Vercel's region, for
 * answers that do not change between clicks: which contractor a session is,
 * what the tenant's projects are, which accounts the dev switcher lists. React's
 * `cache()` only spans one request. This spans a warm function instance, for a
 * bounded number of seconds, and that is the difference between 3-4s and
 * sub-second.
 *
 * D-013 still applies and is the caller's job: **key by tenant**. A key that
 * omits the tenant is a cache that serves one contractor's data to the next.
 * Every call site here keys on the sorted auth-profile ids.
 *
 * Errors are never cached — a failed compute leaves nothing behind, so the next
 * call retries. Concurrent callers for the same key share one in-flight promise
 * rather than each hitting the database.
 */
export interface TtlCache<V> {
  get(key: string, compute: () => Promise<V>): Promise<V>;
  /** Drop everything. For tests, and for the seams that already reset state. */
  clear(): void;
}

export function createTtlCache<V>(ttlMs: number, now: () => number = Date.now): TtlCache<V> {
  const entries = new Map<string, { value: V; expiresAt: number }>();
  const inflight = new Map<string, Promise<V>>();

  return {
    async get(key, compute) {
      const hit = entries.get(key);
      if (hit !== undefined && hit.expiresAt > now()) return hit.value;

      const pending = inflight.get(key);
      if (pending !== undefined) return pending;

      const promise = (async () => {
        try {
          const value = await compute();
          entries.set(key, { value, expiresAt: now() + ttlMs });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    },
    clear() {
      entries.clear();
      inflight.clear();
    },
  };
}
