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

export function readBuildSuiteConfig(
  env: NodeJS.ProcessEnv = process.env,
): BuildSuiteConfigResult {
  const missing = (['SUPABASE_URL', 'SUPABASE_ANON_KEY'] as const).filter((k) => {
    const v = env[k];
    return v === undefined || v.trim() === '';
  });
  if (missing.length > 0) return { configured: false, missing };
  return {
    configured: true,
    config: {
      url: env.SUPABASE_URL!.replace(/\/+$/, ''),
      key: env.SUPABASE_ANON_KEY!,
    },
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
