import type { GhlConfig } from './config.ts';
import { GhlAuthError, GhlError, GhlNotFoundError, GhlRateLimitError } from './errors.ts';

/**
 * HTTP transport for the GHL API.
 *
 * Deliberately knows nothing about projects, contacts, or custom objects — it
 * handles auth headers, retries, rate limits, and error typing. Response shapes
 * live in `mapper.ts`, which is the only file that needs correcting once we
 * have real JSON from Phase 0.
 *
 * Retry policy: exponential backoff with full jitter on 429 and 5xx, honouring
 * `Retry-After` when GHL sends one. Jitter matters because the sync-back job
 * fires every project on the same schedule — without it, a rate limit would
 * cause every request to retry in lockstep and hit the limit again together.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** For error messages — what was being fetched. */
  describe?: string;
  signal?: AbortSignal;
}

export interface GhlClientOptions {
  config: GhlConfig;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests so backoff doesn't actually sleep. */
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
  /** Called on every attempt. Wire to a logger; the sync-back job needs this. */
  onAttempt?: (info: { path: string; attempt: number; status: number | null }) => void;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(random() * ceiling);
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

export class GhlClient {
  private readonly config: GhlConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly onAttempt: GhlClientOptions['onAttempt'];

  constructor(options: GhlClientOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onAttempt = options.onAttempt;
  }

  private url(path: string, query?: RequestOptions['query']): string {
    const url = new URL(`${this.config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const { method = 'GET', path, query, body, describe = path } = options;
    let lastError: GhlError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const signal =
        options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout]);

      let response: Response;
      try {
        response = await this.fetchImpl(this.url(path, query), {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Version: this.config.apiVersion,
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (cause) {
        // Network failure or timeout — retryable.
        this.onAttempt?.({ path, attempt, status: null });
        lastError = new GhlError(`GHL request failed: ${describe}`, { retryable: true });
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      this.onAttempt?.({ path, attempt, status: response.status });

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const text = await response.text().catch(() => null);

      if (response.status === 401 || response.status === 403) {
        throw new GhlAuthError(response.status, text);
      }
      if (response.status === 404) {
        throw new GhlNotFoundError(describe);
      }
      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        lastError = new GhlRateLimitError(retryAfter, text);
        if (attempt < this.maxRetries) {
          await this.sleep(retryAfter ?? backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      if (response.status >= 500) {
        lastError = new GhlError(`GHL server error ${response.status} on ${describe}`, {
          status: response.status,
          retryable: true,
          body: text,
        });
        if (attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }

      // 4xx that isn't auth, missing, or rate limited — a bad request. Never
      // retryable; retrying a malformed call just burns rate limit.
      throw new GhlError(`GHL rejected the request (${response.status}) on ${describe}`, {
        status: response.status,
        retryable: false,
        body: text,
      });
    }

    throw lastError ?? new GhlError(`GHL request exhausted retries: ${describe}`, {
      retryable: false,
    });
  }
}
