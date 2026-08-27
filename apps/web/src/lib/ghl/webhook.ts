import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifying that a webhook really came from GoHighLevel.
 *
 * D4 §3 is the only document that says this plainly, and it is the thing most
 * easily missed: *"custom values alone do not trigger anything. GHL must be told
 * to notify the Hub via webhook when values change. So firing = webhook + key."*
 *
 * The webhook is what makes anything fire. This module is what stops it firing
 * for the wrong person.
 *
 * ---------------------------------------------------------------------------
 * An endpoint that trusts an unsigned payload is an endpoint anyone can post
 * to. Our URL will be public, our workflows move money and publish things to
 * homeowners, and the payload names the project. So:
 *
 *   - No secret configured → **refuse**. Not "allow in development": an
 *     unverifiable webhook is not a webhook, and a dev-only bypass is one
 *     environment variable away from being a production bypass.
 *   - Signature compared in constant time, and computed over the RAW body.
 *     Re-serialising parsed JSON changes bytes — key order, whitespace, number
 *     formatting — and the signature is over what was sent, not over what we
 *     happened to reconstruct.
 *   - Timestamp outside the tolerance → refuse. A valid signature stays valid
 *     forever otherwise, so a captured request could be replayed indefinitely.
 *   - Event id already seen → refuse. The timestamp window narrows replay to a
 *     few minutes; the id closes it.
 * ---------------------------------------------------------------------------
 *
 * Pure on purpose. The route supplies the clock and the seen-id store, so every
 * branch here is testable without a server, a secret, or a real GHL account.
 */

export interface WebhookConfig {
  secret: string;
  /** How far out of date a payload may be. Five minutes matches common practice. */
  toleranceSeconds?: number;
}

export interface WebhookRequest {
  /** The body EXACTLY as received. Never a re-serialised object. */
  rawBody: string;
  signature: string | null;
  /** Unix seconds, as sent by GHL. */
  timestamp: string | null;
}

export type WebhookRefusal =
  | 'not_configured'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'bad_timestamp'
  | 'stale'
  | 'replayed'
  | 'bad_signature'
  | 'malformed_body';

export type WebhookResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; reason: WebhookRefusal };

/** What we can rely on being present. Everything else stays in `raw`. */
export interface WebhookEvent {
  /** GHL's own id for the delivery — the replay key. */
  id: string;
  type: string;
  locationId: string | null;
  raw: Record<string, unknown>;
}

export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Every refusal gets its own message, because they need different fixes. */
export const REFUSAL_REASON: Record<WebhookRefusal, string> = {
  not_configured: 'GHL_WEBHOOK_SECRET is not set — refusing to accept unverifiable webhooks',
  missing_signature: 'request carried no signature header',
  missing_timestamp: 'request carried no timestamp header',
  bad_timestamp: 'timestamp header is not a unix time',
  stale: 'timestamp is outside the tolerance window — possible replay',
  replayed: 'this event id has already been processed',
  bad_signature: 'signature does not match the body',
  malformed_body: 'body is not a JSON object',
};

function signaturesMatch(a: Buffer, b: Buffer): boolean {
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Compare lengths first, then compare contents in constant time.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The signature GHL should have sent for this body.
 *
 * Signed over `timestamp.rawBody` rather than the body alone, so a captured
 * signature cannot be reattached to the same body with a fresher timestamp.
 */
export function expectedSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

export function verifyWebhook(
  request: WebhookRequest,
  config: WebhookConfig,
  now: Date,
  seen?: SeenStore,
): WebhookResult {
  if (config.secret.trim() === '') {
    return { ok: false, reason: 'not_configured' };
  }
  if (request.signature === null || request.signature.trim() === '') {
    return { ok: false, reason: 'missing_signature' };
  }
  if (request.timestamp === null || request.timestamp.trim() === '') {
    return { ok: false, reason: 'missing_timestamp' };
  }

  const sent = Number(request.timestamp);
  if (!Number.isFinite(sent) || !Number.isInteger(sent)) {
    return { ok: false, reason: 'bad_timestamp' };
  }

  const tolerance = config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const drift = Math.abs(Math.floor(now.getTime() / 1000) - sent);
  // Absolute drift, so a timestamp from the future is refused too — a clock
  // skewed forward would otherwise widen the replay window indefinitely.
  if (drift > tolerance) {
    return { ok: false, reason: 'stale' };
  }

  const expected = expectedSignature(config.secret, request.timestamp, request.rawBody);
  const matched = signaturesMatch(
    Buffer.from(expected, 'utf8'),
    Buffer.from(request.signature.trim(), 'utf8'),
  );
  if (!matched) {
    return { ok: false, reason: 'bad_signature' };
  }

  // Parse only AFTER the signature passes. Parsing first would run our JSON
  // parser over bytes from an unauthenticated source.
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.rawBody);
  } catch {
    return { ok: false, reason: 'malformed_body' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'malformed_body' };
  }

  const body = parsed as Record<string, unknown>;
  const id = firstString(body, ['webhookId', 'id', 'eventId']);
  const type = firstString(body, ['type', 'event', 'eventType']);

  if (id === null || type === null) {
    return { ok: false, reason: 'malformed_body' };
  }

  if (seen !== undefined) {
    if (seen.has(id)) return { ok: false, reason: 'replayed' };
    seen.add(id);
  }

  return {
    ok: true,
    event: {
      id,
      type,
      locationId: firstString(body, ['locationId', 'location_id']),
      raw: body,
    },
  };
}

function firstString(body: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/**
 * Replay protection, in memory.
 *
 * **A known limitation, and deliberately a small one.** Serverless means several
 * instances, each with their own set, so a replay could land on a cold instance
 * and be accepted. What still holds is the timestamp window: an attacker has the
 * tolerance, not forever.
 *
 * The durable version is a `hub_webhook_deliveries` table with a unique id.
 * Worth adding when webhooks carry something irreversible; not worth blocking
 * the receiver on today, when nothing is wired to them yet.
 */
export function createSeenStore(limit = 1000): SeenStore {
  const ids = new Set<string>();
  const order: string[] = [];
  return {
    has: (id) => ids.has(id),
    add: (id) => {
      ids.add(id);
      order.push(id);
      // Bounded, or a long-lived instance leaks memory one delivery at a time.
      while (order.length > limit) {
        const oldest = order.shift();
        if (oldest !== undefined) ids.delete(oldest);
      }
    },
  };
}

export function readWebhookConfig(
  env: NodeJS.ProcessEnv = process.env,
): { configured: true; config: WebhookConfig } | { configured: false } {
  const secret = env.GHL_WEBHOOK_SECRET ?? '';
  if (secret.trim() === '') return { configured: false };
  return { configured: true, config: { secret } };
}
