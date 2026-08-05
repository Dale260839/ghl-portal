/**
 * Typed failures from the GHL API.
 *
 * Separated by whether retrying could plausibly help, because the sync-back job
 * (§8.3) runs unattended hourly and needs to distinguish "try again in a minute"
 * from "this will never work, stop and alert".
 */

export class GhlError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  readonly body: string | null;

  constructor(
    message: string,
    options: { status?: number | null; retryable: boolean; body?: string | null },
  ) {
    super(message);
    this.name = 'GhlError';
    this.status = options.status ?? null;
    this.retryable = options.retryable;
    this.body = options.body ?? null;
  }
}

/** 401/403 — the token is wrong or lacks scope. Retrying never fixes this. */
export class GhlAuthError extends GhlError {
  constructor(status: number, body: string | null) {
    super(
      `GHL rejected the credentials (${status}). Check GHL_PRIVATE_INTEGRATION_TOKEN and that it is scoped to GHL_LOCATION_ID.`,
      { status, retryable: false, body },
    );
    this.name = 'GhlAuthError';
  }
}

/** 429 — back off and try again. */
export class GhlRateLimitError extends GhlError {
  readonly retryAfterMs: number | null;

  constructor(retryAfterMs: number | null, body: string | null) {
    super('GHL rate limit hit', { status: 429, retryable: true, body });
    this.name = 'GhlRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class GhlNotFoundError extends GhlError {
  constructor(what: string) {
    super(`GHL returned 404 for ${what}`, { status: 404, retryable: false });
    this.name = 'GhlNotFoundError';
  }
}
