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
 * RLS IS CURRENTLY OFF ON THIS DATABASE (owner's decision, 2026-08-31, so the
 * build is not blocked writing policies for screens that do not exist yet).
 *
 * That makes the two guarantees below load-bearing rather than belt-and-braces:
 *
 *   · `server-only` above — importing this from a client component fails the
 *     build, so the key cannot reach a browser.
 *   · `HUB_SUPABASE_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js will not
 *     inline it into client bundles. A guardrail test asserts that.
 *
 * Tenancy is enforced in application code, exactly as it is for BuildSuite
 * reads: every method here takes a scope and refuses without one.
 * ---------------------------------------------------------------------------
 */

export interface HubConfig {
  url: string;
  key: string;
}

export type HubConfigResult =
  | { configured: true; config: HubConfig }
  | { configured: false; missing: string[] };

export function readHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfigResult {
  const missing = (['HUB_SUPABASE_URL', 'HUB_SUPABASE_KEY'] as const).filter((k) => {
    const v = env[k];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) return { configured: false, missing };
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
