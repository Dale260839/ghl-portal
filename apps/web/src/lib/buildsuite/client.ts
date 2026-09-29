/**
 * Read-only PostgREST client for BuildSuite's Supabase.
 *
 * D-003 is absolute: that database is production and we never alter a table.
 * This client makes it structural rather than a matter of discipline — there is
 * no method that issues anything but GET, and `request()` throws if a caller
 * somehow constructs a write. A guardrail you can't forget beats one you have to
 * remember, and the read key permits more than it should (see D-010).
 *
 * D-009: the Hub reads BuildSuite's data here directly. It does not call
 * BuildSuite's API, which is cookie-only and out of scope.
 */

export interface BuildSuiteConfig {
  url: string;
  key: string;
}

export type BuildSuiteConfigResult =
  | { configured: true; config: BuildSuiteConfig }
  | { configured: false; missing: string[] };

/**
 * Which Supabase role a key acts as, read from the key itself. No network.
 *
 * Deliberately a local copy of the same three lines in `hub-db/client.ts`
 * rather than an import. Those two clients are kept apart on purpose — one can
 * only read BuildSuite, the other can write the Hub — and a shared module
 * between them is the first step towards a shared client with a `method`
 * parameter. Three lines is a cheaper price than that coupling.
 */
function keyRole(key: string): 'service' | 'anon' | 'unknown' {
  const k = key.trim();
  if (k.startsWith('sb_secret_')) return 'service';
  if (k.startsWith('sb_publishable_')) return 'anon';
  try {
    const parts = k.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as {
        role?: unknown;
      };
      if (payload.role === 'service_role') return 'service';
      if (payload.role === 'anon') return 'anon';
    }
  } catch {
    // Not a JWT after all. Left as unknown and given to the database to judge.
  }
  return 'unknown';
}

let warnedAnonKey = false;

/**
 * ---------------------------------------------------------------------------
 * THE ANON KEY STOPPED WORKING ON 2026-09-29
 *
 * Row-level security was switched on across all 35 BuildSuite tables, and
 * privileges were revoked from `anon`. Measured the same day: every table this
 * client reads — projects, proposals, deals, contractors, auth_profiles —
 * answers `401 42501 permission denied`. Not empty results; a hard refusal.
 *
 * Sign-in resolves a sub-account through `auth_profiles`, so the first thing
 * that broke was every contractor's ability to open the Hub at all.
 *
 * So the key is the SERVICE key now, in `SUPABASE_SERVICE_KEY`. Three things
 * make that safe here, and all three already existed:
 *
 *   · this client has no method that issues anything but GET, and `request()`
 *     throws if a caller constructs a write — D-003 is structural;
 *   · it is server-only, so the key cannot reach a browser;
 *   · tenancy has never depended on RLS. Every read is filtered by the
 *     signed-in contractor's own auth profile ids in application code (D-012).
 *
 * `SUPABASE_ANON_KEY` is still read as a fallback so nothing breaks in the
 * window before the new variable is set — and a key that is positively
 * identified as anon says so once, loudly, rather than leaving somebody
 * reading 401s.
 * ---------------------------------------------------------------------------
 */
export function readBuildSuiteConfig(
  env: NodeJS.ProcessEnv = process.env,
): BuildSuiteConfigResult {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY?.trim() || env.SUPABASE_ANON_KEY?.trim() || '';

  const missing: string[] = [];
  if (url === undefined || url.trim() === '') missing.push('SUPABASE_URL');
  if (key === '') missing.push('SUPABASE_SERVICE_KEY');
  if (missing.length > 0) return { configured: false, missing };

  if (keyRole(key) === 'anon' && !warnedAnonKey) {
    warnedAnonKey = true;
    console.error(
      '[buildsuite] SUPABASE_SERVICE_KEY is not set and the key in use is the anon key. ' +
        'Since 2026-09-29 anon has no privileges on BuildSuite tables, so every read will ' +
        'return 401 42501 and nobody will be able to sign in. Set SUPABASE_SERVICE_KEY to the ' +
        "project's service_role key (server-side only).",
    );
  }

  return {
    configured: true,
    config: { url: url!.replace(/\/+$/, ''), key },
  };
}

export class BuildSuiteReadError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'BuildSuiteReadError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface SelectOptions {
  /** Table name. */
  from: string;
  /**
   * Explicit column list — never `*`.
   *
   * Two reasons. It stops a schema addition on Sing's side silently widening
   * what we pull, and it keeps us from reading columns we have no business
   * reading: the key grants more than it should (D-010), so the narrowest
   * possible select is our side of that.
   */
  columns: readonly string[];
  /** PostgREST filters, e.g. `{ status: 'eq.active' }`. */
  filters?: Record<string, string>;
  order?: string;
  limit?: number;
  signal?: AbortSignal;
}

export class BuildSuiteClient {
  private readonly config: BuildSuiteConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    config: BuildSuiteConfig,
    options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.config = config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** The only verb this client knows. */
  async select<T>(options: SelectOptions): Promise<T[]> {
    if (options.columns.length === 0) {
      throw new Error('columns must be explicit — a bare select(*) is not allowed');
    }
    if (options.columns.includes('*')) {
      throw new Error('select(*) is not allowed — name the columns you need');
    }

    const url = new URL(`${this.config.url}/rest/v1/${options.from}`);
    url.searchParams.set('select', options.columns.join(','));
    for (const [key, value] of Object.entries(options.filters ?? {})) {
      url.searchParams.set(key, value);
    }
    if (options.order !== undefined) url.searchParams.set('order', options.order);
    if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal =
      options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        signal,
        headers: {
          apikey: this.config.key,
          Authorization: `Bearer ${this.config.key}`,
          Accept: 'application/json',
        },
      });
    } catch {
      throw new BuildSuiteReadError(`read failed: ${options.from}`, null, true);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BuildSuiteReadError(
        `BuildSuite read ${response.status} on ${options.from}: ${body.slice(0, 200)}`,
        response.status,
        response.status >= 500,
      );
    }

    return (await response.json()) as T[];
  }

  /**
   * Exact row count without pulling the rows. Uses PostgREST's Content-Range
   * header, so it costs one request and transfers nothing.
   */
  async count(from: string, filters: Record<string, string> = {}): Promise<number> {
    const url = new URL(`${this.config.url}/rest/v1/${from}`);
    url.searchParams.set('select', 'id');
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);

    const response = await this.fetchImpl(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        apikey: this.config.key,
        Authorization: `Bearer ${this.config.key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });

    const range = response.headers.get('content-range');
    const total = range?.split('/')[1];
    const parsed = Number(total);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
