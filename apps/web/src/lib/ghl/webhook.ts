import { createHash, createHmac, createPublicKey, createVerify, timingSafeEqual, verify } from 'node:crypto';

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
 *   - No verification key configured → **refuse**. Not "allow in development": an
 *     unverifiable webhook is not a webhook, and a dev-only bypass is one
 *     environment variable away from being a production bypass.
 *   - Signature compared in constant time, and computed over the RAW body.
 *     Re-serialising parsed JSON changes bytes — key order, whitespace, number
 *     formatting — and the signature is over what was sent, not over what we
 *     happened to reconstruct.
 *   - Relay timestamps are mandatory; native delivery timestamps are checked
 *     when present. Native record creation dates are not delivery timestamps.
 *   - An optional seen store can reject repeated deliveries in isolated tests.
 *     The HTTP route does not use it: processing and durable idempotency must
 *     be implemented together before business effects can run safely.
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
  | 'malformed_body'
  | 'bad_public_key';

export type WebhookResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; reason: WebhookRefusal };

/** What we can rely on being present. Everything else stays in `raw`. */
export interface WebhookEvent {
  /** Delivery replay key, not the resource id in native GHL payloads. */
  id: string;
  type: string;
  locationId: string | null;
  raw: Record<string, unknown>;
}

export const DEFAULT_TOLERANCE_SECONDS = 300;

/** Every refusal gets its own message, because they need different fixes. */
export const REFUSAL_REASON: Record<WebhookRefusal, string> = {
  not_configured: 'webhook verification is unconfigured — refusing unverifiable webhooks',
  missing_signature: 'request carried no signature header',
  missing_timestamp: 'request carried no timestamp header',
  bad_timestamp: 'timestamp header is not a unix time',
  stale: 'timestamp is outside the tolerance window — possible replay',
  replayed: 'this delivery key is already in the supplied seen store',
  bad_signature: 'signature does not match the body',
  malformed_body: 'body is not a JSON object',
  bad_public_key: 'the configured public key is not usable for this signature algorithm',
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

// ── GoHighLevel's own signature ─────────────────────────────────────────────
/**
 * Native signatures, distinct from relay HMAC.
 *
 * Everything above verifies an HMAC over a shared secret. GHL's *native*
 * webhooks do not work that way: they are signed with GHL's own private key and
 * verified with a public key they publish. So a shared secret can only ever be
 * checked if something in the middle re-signs with it — an n8n relay or a small
 * Marketplace app.
 *
 * Current X-GHL-Signature deliveries use Ed25519; legacy X-WH-Signature
 * deliveries use RSA-SHA256. Relay HMAC remains available only on x-signature.
 * Header presence selects the algorithm; a failed current signature must not
 * downgrade to an older header. Live ingestion/execution remains unverified.
 */

/** Native signature over the raw body; algorithm is selected separately. */
export interface GhlWebhookConfig {
  /** GHL's published webhook public key, PEM encoded. */
  publicKey: string;
  toleranceSeconds?: number;
}

/**
 * Verify GHL's signature over the body.
 *
 * Returns `null` when the key itself cannot be used, which is a different
 * problem from a bad signature: one is our misconfiguration and the other is a
 * hostile or corrupted request, and they need different alerts.
 */
export function verifyRsaSignature(
  rawBody: string,
  signatureBase64: string,
  publicKeyPem: string,
): boolean | null {
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(rawBody, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64.trim(), 'base64');
  } catch (error) {
    // An unusable key throws here; so does a signature that is not valid
    // base64. Distinguish by testing the key on its own.
    try {
      const probe = createVerify('RSA-SHA256');
      probe.update('probe', 'utf8');
      probe.end();
      probe.verify(publicKeyPem, Buffer.alloc(0));
      return false; // key is fine, so the signature was the problem
    } catch {
      void error;
      return null; // the key is the problem
    }
  }
}

/** Current X-GHL-Signature scheme; never verify an Ed25519 header as RSA/HMAC. */
export function verifyEd25519Signature(rawBody: string, signature: string, publicKeyPem: string): boolean | null {
  let key;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return null;
  } catch {
    return null;
  }
  try {
    return verify(null, Buffer.from(rawBody, 'utf8'), key, Buffer.from(signature.trim(), 'base64'));
  } catch {
    return false;
  }
}

/**
 * Read a freshness timestamp out of an already-verified body.
 *
 * GHL's native delivery does not carry the `timestamp` header the HMAC path
 * relies on, so the replay window has to come from the payload instead. This is
 * only ever called AFTER the signature passes, so the value is attacker-visible
 * but not attacker-chosen: changing it would invalidate the signature.
 *
 * Returns `null` when there is nothing to check, and the caller treats that as
 * "no freshness evidence" rather than as fresh.
 */
export function bodyTimestampSeconds(body: Record<string, unknown>): number | null {
  for (const key of ['timestamp', 'webhookTimestamp', 'createdAt', 'dateAdded']) {
    const value = body[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      // Milliseconds if it is far too large to be seconds.
      return value > 1e11 ? Math.floor(value / 1000) : Math.floor(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && value.trim() === String(asNumber)) {
        return asNumber > 1e11 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
      }
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
    }
  }
  return null;
}

/**
 * Verify a webhook GoHighLevel signed itself.
 *
 * Same order of operations as the HMAC path and for the same reason: the
 * signature is checked over the raw bytes BEFORE anything is parsed, so our
 * JSON parser never runs over an unauthenticated payload. Freshness moves after
 * the parse only because the timestamp lives inside the signed body.
 */
export function verifyGhlWebhook(
  request: WebhookRequest,
  config: GhlWebhookConfig,
  now: Date,
  seen?: SeenStore,
): WebhookResult {
  return verifyNativeWebhook(request, config, now, verifyRsaSignature, seen);
}

export function verifyEd25519Webhook(
  request: WebhookRequest,
  config: GhlWebhookConfig,
  now: Date,
  seen?: SeenStore,
): WebhookResult {
  return verifyNativeWebhook(request, config, now, verifyEd25519Signature, seen);
}

function verifyNativeWebhook(
  request: WebhookRequest,
  config: GhlWebhookConfig,
  now: Date,
  checkSignature: (body: string, signature: string, key: string) => boolean | null,
  seen?: SeenStore,
): WebhookResult {
  if (config.publicKey.trim() === '') {
    return { ok: false, reason: 'not_configured' };
  }
  if (request.signature === null || request.signature.trim() === '') {
    return { ok: false, reason: 'missing_signature' };
  }

  const verified = checkSignature(request.rawBody, request.signature, config.publicKey);
  if (verified === null) return { ok: false, reason: 'bad_public_key' };
  if (!verified) return { ok: false, reason: 'bad_signature' };

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
  // Native `id` identifies the contact/opportunity, not this delivery. Using it
  // as a replay key would drop the next legitimate update to that same record.
  const deliveryId = firstString(body, ['webhookId', 'eventId']);
  if (deliveryId === null && firstString(body, ['id']) === null) {
    return { ok: false, reason: 'malformed_body' };
  }
  const id = deliveryId ??
    `body:${createHash('sha256').update(request.rawBody).digest('hex')}`;
  const type = firstString(body, ['type', 'event', 'eventType']);
  if (type === null) {
    return { ok: false, reason: 'malformed_body' };
  }

  // Freshness, when the payload gives us something to judge it by. A body with
  // no timestamp is not refused: GHL decides that payload's shape, not us, and
  // refusing would drop real events. The replay id below is then the only
  // protection, which is why the durable store matters more on this path.
  // dateAdded/createdAt belong to the business record, not webhook delivery.
  const sentAt = bodyTimestampSeconds({ timestamp: body.timestamp, webhookTimestamp: body.webhookTimestamp });
  if (sentAt !== null) {
    const tolerance = config.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
    if (Math.abs(Math.floor(now.getTime() / 1000) - sentAt) > tolerance) {
      return { ok: false, reason: 'stale' };
    }
  }

  if (seen !== undefined) {
    if (seen.has(id)) return { ok: false, reason: 'replayed' };
    seen.add(id);
  }

  return {
    ok: true,
    event: { id, type, locationId: firstString(body, ['locationId', 'location_id']), raw: body },
  };
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
 * Test helper, not production idempotency. Serverless instances do not share
 * this set, and native events can omit a delivery timestamp. Never rely on it
 * to protect business effects. A future executor needs approved durable
 * ingestion and effect-level idempotency, marking completion only on success.
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

/**
 * Which scheme this deployment accepts.
 *
 * A header-selected scheme uses only its corresponding configuration. Without
 * a requested scheme, prefer current Ed25519, then legacy RSA, then relay HMAC.
 *
 * Neither configured is still a refusal, unchanged: an unverifiable webhook is
 * not a webhook, and a development bypass is one environment variable away from
 * being a production bypass.
 */
export type WebhookScheme =
  | { scheme: 'ghl-ed25519'; config: GhlWebhookConfig }
  | { scheme: 'ghl'; config: GhlWebhookConfig }
  | { scheme: 'hmac'; config: WebhookConfig }
  | { scheme: 'none' };

export function readWebhookScheme(
  env: NodeJS.ProcessEnv = process.env,
  requested?: Exclude<WebhookScheme['scheme'], 'none'>,
): WebhookScheme {
  const currentKey = (env.GHL_WEBHOOK_ED25519_PUBLIC_KEY ?? '').replace(/\\n/g, '\n').trim();
  if ((requested === undefined || requested === 'ghl-ed25519') && currentKey !== '') {
    return { scheme: 'ghl-ed25519', config: { publicKey: currentKey } };
  }
  // Env vars cannot hold newlines cleanly, so an escaped PEM is normalised here
  // rather than making every deployment remember to do it.
  const publicKey = (env.GHL_WEBHOOK_PUBLIC_KEY ?? '').replace(/\\n/g, '\n').trim();
  if ((requested === undefined || requested === 'ghl') && publicKey !== '') return { scheme: 'ghl', config: { publicKey } };

  const secret = (env.GHL_WEBHOOK_SECRET ?? '').trim();
  if ((requested === undefined || requested === 'hmac') && secret !== '') return { scheme: 'hmac', config: { secret } };

  return { scheme: 'none' };
}

/** Verify with the selected algorithm; no fallback after signature failure. */
export function verifyInboundWebhook(
  request: WebhookRequest,
  scheme: WebhookScheme,
  now: Date,
  seen?: SeenStore,
): WebhookResult {
  if (scheme.scheme === 'none') return { ok: false, reason: 'not_configured' };
  if (scheme.scheme === 'ghl-ed25519') return verifyEd25519Webhook(request, scheme.config, now, seen);
  if (scheme.scheme === 'ghl') return verifyGhlWebhook(request, scheme.config, now, seen);
  return verifyWebhook(request, scheme.config, now, seen);
}
