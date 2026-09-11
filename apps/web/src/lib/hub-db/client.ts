import 'server-only';

/**
 * The Hub's own database — the one place this application writes.
 *
 * Deliberately a separate module from `buildsuite/client.ts`, and the split is
 * the point:
 *
 *   `BuildSuiteClient` can only ever issue GET. It has no write method, so
 *   writing to production is not a discipline anyone has to remember.
 *
 *   This client writes. It talks to a different Supabase project, which the
 *   Hub owns, and nothing it does can reach BuildSuite.
 *
 * Mixing the two into one configurable client would put a `method` parameter
 * one typo away from a write against someone else's production data. Two
 * clients, two connection strings, one of them structurally read-only.
 *
 * ---------------------------------------------------------------------------
 * RLS IS ON, AND THIS KEY MUST BE THE SECRET ONE (since 0010, run 2026-09-12)
 *
 * RLS was off from 2026-08-31 (owner's decision, so policy-writing did not block
 * the build). Migration 0010 turned it on for every Hub table and revoked all
 * privileges from `anon`, with no policies — the only client of these tables is
 * this server, holding the service role, which RLS does not apply to.
 *
 * So `HUB_SUPABASE_KEY` must be the project's SECRET key (`sb_secret_…`, or a
 * legacy `service_role` JWT). The publishable key can no longer touch a row;
 * `readHubConfig` recognises it and reports the Hub unavailable rather than
 * letting every read fail with `42501`.
 *
 * A secret key makes these two guarantees MORE load-bearing, not less — it
 * bypasses RLS entirely, so where it lives is the whole defence:
 *
 *   · `server-only` above — importing this from a client component fails the
 *     build, so the key cannot reach a browser.
 *   · `HUB_SUPABASE_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js will not
 *     inline it into client bundles. A guardrail test asserts that.
 *
 * Tenancy is enforced in application code, exactly as it is for BuildSuite
 * reads: every method here takes a scope and refuses without one. RLS is the
 * second lock, not a replacement for the first.
 * ---------------------------------------------------------------------------
 */

export interface HubConfig {
  url: string;
  key: string;
}

export type HubConfigResult =
  | { configured: true; config: HubConfig }
  | { configured: false; missing: string[] };

/**
 * Which Supabase role a key acts as, read from the key itself. No network.
 *
 * Both formats carry the answer. The new-style keys say it in the prefix —
 * `sb_secret_` is the service role, `sb_publishable_` is anon. A legacy JWT
 * says it in the `role` claim of its payload, which is base64, not encrypted:
 * reading it needs no secret and verifies nothing, and nothing here relies on
 * it for more than "which key did somebody paste".
 *
 * `unknown` is not a refusal. A key this cannot classify is allowed through and
 * left to the database to judge — only a key positively identified as anon is
 * turned away, so a format Supabase introduces later cannot lock the Hub out.
 */
export function hubKeyRole(key: string): 'service' | 'anon' | 'unknown' {
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'service';
  if (k.startsWith('sb_publishable_')) return 'anon';

  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
        role?: unknown;
      };
      if (payload.role === 'service_role') return 'service';
      if (payload.role === 'anon') return 'anon';
    } catch {
      // Not a JWT after all. Fall through to unknown.
    }
  }
  return 'unknown';
}

/**
 * What a screen shows when the Hub key is the wrong one.
 *
 * Phrased to sit after the "Missing:" that every Hub-backed screen already
 * prints, so none of them needed changing to explain this.
 */
export const HUB_ANON_KEY_REASON =
  "the Hub's secret key — HUB_SUPABASE_KEY is set to the publishable (anon) key, which migration 0010 locked out of every Hub table";

let warnedAnonKey = false;

export function readHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfigResult {
  const missing = (['HUB_SUPABASE_URL', 'HUB_SUPABASE_KEY'] as const).filter((k) => {
    const v = env[k];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) return { configured: false, missing };

  // ---------------------------------------------------------------------------
  // THE ANON KEY IS NOW A MISCONFIGURATION, NOT A KEY (2026-09-12)
  //
  // Migration 0010 revokes every table privilege from `anon`. After it, the
  // publishable key cannot read or write a single Hub row — every request comes
  // back `42501 permission denied`.
  //
  // Found by switching accounts on the live site: 0010 had been run before the
  // key was swapped, and the dashboard LAYOUT read `hub_issues` unguarded, so
  // the first page after sign-in was a bare "Application error" with a digest.
  // Every Hub-backed screen would have done the same.
  //
  // Refusing the key HERE, before any request, turns that into the "Hub not
  // connected" state every screen already renders, with a reason that names the
  // fix. Nothing is fetched to find out, so an outage cannot be misread as this.
  //
  // What this must never become is a reason to re-grant `anon`. That reopens
  // every contractor's rows to a key that is, by design, not a secret. The fix
  // is the secret key, on the server, where it already lives.
  // ---------------------------------------------------------------------------
  if (hubKeyRole(env.HUB_SUPABASE_KEY!) === 'anon') {
    if (!warnedAnonKey) {
      warnedAnonKey = true;
      console.error(
        '[hub] HUB_SUPABASE_KEY is the publishable (anon) key. Migration 0010 revoked anon from ' +
          "every Hub table, so the Hub is disabled until it is replaced with the project's secret " +
          '(service_role) key: Supabase > nexpqqxarimqmntnvzff > Settings > API Keys.',
      );
    }
    return { configured: false, missing: [HUB_ANON_KEY_REASON] };
  }

  return {
    configured: true,
    config: {
      url: env.HUB_SUPABASE_URL!.replace(/\/+$/, ''),
      key: env.HUB_SUPABASE_KEY!,
    },
  };
}

export class HubWriteError extends Error {
  readonly status: number | null;
  readonly table: string;

  constructor(message: string, status: number | null, table: string) {
    super(message);
    this.name = 'HubWriteError';
    this.status = status;
    this.table = table;
  }
}

export interface SelectArgs {
  from: string;
  columns?: readonly string[];
  /** PostgREST filters, e.g. `{ contractor_id: 'eq.<uuid>' }`. */
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
}

export interface WriteArgs {
  from: string;
  /** Rows to insert. Always an array, so one row and many take one code path. */
  rows: Record<string, unknown>[];
}

export interface UpdateArgs {
  from: string;
  filters: Record<string, string>;
  patch: Record<string, unknown>;
}

/**
 * Thin PostgREST client. Insert, update and select only.
 *
 * **There is no `delete`, and that is a design decision, not an omission.**
 * Records are archived by setting `archived_at`, because the approval trail is
 * what the privacy model rests on and a deleted row destroys the evidence of
 * who published what. If a hard delete is ever genuinely needed it should be a
 * deliberate addition with its own review, not something already sitting here.
 */
export class HubClient {
  private readonly config: HubConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HubConfig, options: { fetchImpl?: typeof fetch } = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.config.key,
      Authorization: `Bearer ${this.config.key}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  private async request(
    url: string,
    init: RequestInit,
    table: string,
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, init);
    if (!response.ok) {
      const body = await response.text();
      // The body carries PostgREST's reason — an RLS refusal reads very
      // differently from a bad column, and a caller debugging at 6pm needs the
      // difference rather than "request failed".
      throw new HubWriteError(
        `${init.method ?? 'GET'} ${table} failed: ${response.status} ${body.slice(0, 300)}`,
        response.status,
        table,
      );
    }
    const text = await response.text();
    return text === '' ? [] : JSON.parse(text);
  }

  async select<T>({ from, columns, filters = {}, order, limit }: SelectArgs): Promise<T[]> {
    const params = new URLSearchParams();
    params.set('select', columns === undefined ? '*' : columns.join(','));
    for (const [k, v] of Object.entries(filters)) params.set(k, v);
    if (order !== undefined) params.set('order', order);
    if (limit !== undefined) params.set('limit', String(limit));

    const rows = await this.request(
      `${this.config.url}/rest/v1/${from}?${params}`,
      { method: 'GET', headers: this.headers() },
      from,
    );
    return rows as T[];
  }

  async insert<T>({ from, rows }: WriteArgs): Promise<T[]> {
    if (rows.length === 0) return [];
    const inserted = await this.request(
      `${this.config.url}/rest/v1/${from}`,
      {
        method: 'POST',
        headers: this.headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(rows),
      },
      from,
    );
    return inserted as T[];
  }

  async update<T>({ from, filters, patch }: UpdateArgs): Promise<T[]> {
    // An unfiltered PATCH updates every row in the table. PostgREST allows it;
    // we do not. This is the single most destructive mistake available here.
    if (Object.keys(filters).length === 0) {
      throw new HubWriteError(
        `refusing to update every row in ${from} — an unfiltered PATCH is never intentional`,
        null,
        from,
      );
    }

    const params = new URLSearchParams(filters);
    const updated = await this.request(
      `${this.config.url}/rest/v1/${from}?${params}`,
      {
        method: 'PATCH',
        headers: this.headers({ Prefer: 'return=representation' }),
        body: JSON.stringify(patch),
      },
      from,
    );
    return updated as T[];
  }

  /** Insert-or-update on a unique constraint. Used for the project overlay. */
  async upsert<T>({ from, rows }: WriteArgs, onConflict: string): Promise<T[]> {
    if (rows.length === 0) return [];
    const params = new URLSearchParams({ on_conflict: onConflict });
    const result = await this.request(
      `${this.config.url}/rest/v1/${from}?${params}`,
      {
        method: 'POST',
        headers: this.headers({
          Prefer: 'return=representation,resolution=merge-duplicates',
        }),
        body: JSON.stringify(rows),
      },
      from,
    );
    return result as T[];
  }
}

let cached: HubClient | null = null;

export type HubAvailability =
  | { available: true; client: HubClient }
  | { available: false; missing: string[] };

export function getHubClient(): HubAvailability {
  if (cached !== null) return { available: true, client: cached };
  const result = readHubConfig();
  if (!result.configured) return { available: false, missing: result.missing };
  cached = new HubClient(result.config);
  return { available: true, client: cached };
}

/** Test seam — the module-level cache must not leak between tests. */
export function resetHubClient(): void {
  cached = null;
}
