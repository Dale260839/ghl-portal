import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';

import {
  bodyTimestampSeconds,
  createSeenStore,
  readWebhookScheme,
  verifyGhlWebhook,
  verifyInboundWebhook,
  verifyRsaSignature,
  type GhlWebhookConfig,
} from './webhook.ts';

/**
 * Verified against a real RSA keypair rather than a stub, so these tests prove
 * the crypto is actually wired and not just that our branches are reachable.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const NOW = new Date('2026-09-05T00:00:00Z');

function sign(rawBody: string): string {
  const signer = createSign('RSA-SHA256');
  signer.update(rawBody, 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function bodyOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    webhookId: 'wh-1',
    type: 'ContactCreate',
    locationId: 'IifYfP2B2NUaoDPdsTTa',
    timestamp: Math.floor(NOW.getTime() / 1000),
    ...over,
  });
}

const config: GhlWebhookConfig = { publicKey };

test('a genuinely GHL-signed webhook is accepted', () => {
  const raw = bodyOf();
  const result = verifyGhlWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, config, NOW);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.event.id, 'wh-1');
  assert.equal(result.ok && result.event.locationId, 'IifYfP2B2NUaoDPdsTTa');
});

test('no timestamp header is needed — GHL does not send one', () => {
  const raw = bodyOf();
  const result = verifyGhlWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, config, NOW);
  assert.equal(result.ok, true);
});

test('a body altered after signing is refused', () => {
  const raw = bodyOf();
  const signature = sign(raw);
  const tampered = raw.replace('ContactCreate', 'ContactDelete');

  const result = verifyGhlWebhook({ rawBody: tampered, signature, timestamp: null }, config, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'bad_signature');
});

test('a signature from the wrong key is refused', () => {
  const other = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const raw = bodyOf();
  const signer = createSign('RSA-SHA256');
  signer.update(raw, 'utf8');
  signer.end();

  const result = verifyGhlWebhook(
    { rawBody: raw, signature: signer.sign(other.privateKey, 'base64'), timestamp: null },
    config,
    NOW,
  );
  assert.equal(result.ok === false && result.reason, 'bad_signature');
});

test('a missing signature is refused before anything is parsed', () => {
  const result = verifyGhlWebhook({ rawBody: bodyOf(), signature: null, timestamp: null }, config, NOW);
  assert.equal(result.ok === false && result.reason, 'missing_signature');
});

test('an unusable public key is distinguished from a bad signature', () => {
  const raw = bodyOf();
  const result = verifyGhlWebhook(
    { rawBody: raw, signature: sign(raw), timestamp: null },
    { publicKey: 'not a pem at all' },
    NOW,
  );
  // Our misconfiguration, not a hostile request — they need different alerts.
  assert.equal(result.ok === false && result.reason, 'bad_public_key');
});

test('an empty key is not configured, rather than a key failure', () => {
  const result = verifyGhlWebhook({ rawBody: bodyOf(), signature: 'x', timestamp: null }, { publicKey: '  ' }, NOW);
  assert.equal(result.ok === false && result.reason, 'not_configured');
});

test('a correctly signed but stale payload is refused', () => {
  const raw = bodyOf({ timestamp: Math.floor(NOW.getTime() / 1000) - 3600 });
  const result = verifyGhlWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, config, NOW);
  assert.equal(result.ok === false && result.reason, 'stale');
});

test('a payload with no timestamp is accepted, because GHL owns that shape', () => {
  const raw = JSON.stringify({ webhookId: 'wh-2', type: 'ContactCreate' });
  const result = verifyGhlWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, config, NOW);
  assert.equal(result.ok, true, 'refusing would drop real events we cannot judge');
});

test('the same delivery twice is refused the second time', () => {
  const raw = bodyOf();
  const signature = sign(raw);
  const seen = createSeenStore();

  assert.equal(verifyGhlWebhook({ rawBody: raw, signature, timestamp: null }, config, NOW, seen).ok, true);
  const replay = verifyGhlWebhook({ rawBody: raw, signature, timestamp: null }, config, NOW, seen);
  assert.equal(replay.ok === false && replay.reason, 'replayed');
});

test('a signed body that is not a JSON object is refused', () => {
  const raw = '"just a string"';
  const result = verifyGhlWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, config, NOW);
  assert.equal(result.ok === false && result.reason, 'malformed_body');
});

// ── Timestamp extraction ────────────────────────────────────────────────────

test('timestamps are read as seconds, milliseconds, or an ISO date', () => {
  assert.equal(bodyTimestampSeconds({ timestamp: 1_788_000_000 }), 1_788_000_000);
  assert.equal(bodyTimestampSeconds({ timestamp: 1_788_000_000_000 }), 1_788_000_000);
  const iso = Math.floor(Date.parse('2026-09-05T00:00:00Z') / 1000);
  assert.equal(bodyTimestampSeconds({ timestamp: '2026-09-05T00:00:00Z' }), iso);
  assert.equal(bodyTimestampSeconds({ createdAt: '2026-09-05T00:00:00Z' }), iso);
});

test('a body with nothing usable yields null, not a fake freshness', () => {
  assert.equal(bodyTimestampSeconds({}), null);
  assert.equal(bodyTimestampSeconds({ timestamp: 'not a date' }), null);
});

// ── Scheme selection ────────────────────────────────────────────────────────

test('GHL public key wins over a shared secret when both are set', () => {
  const scheme = readWebhookScheme({
    GHL_WEBHOOK_PUBLIC_KEY: publicKey,
    GHL_WEBHOOK_SECRET: 'a-shared-secret',
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(scheme.scheme, 'ghl', 'a relay HMAC would be dead config if GHL signs directly');
});

test('an escaped PEM from an env var is normalised', () => {
  const escaped = publicKey.replace(/\n/g, '\\n');
  const scheme = readWebhookScheme({ GHL_WEBHOOK_PUBLIC_KEY: escaped } as unknown as NodeJS.ProcessEnv);
  assert.equal(scheme.scheme, 'ghl');

  const raw = bodyOf();
  const result = verifyInboundWebhook({ rawBody: raw, signature: sign(raw), timestamp: null }, scheme, NOW);
  assert.equal(result.ok, true, 'the normalised key must actually verify');
});

test('with only a secret set, the HMAC scheme is chosen', () => {
  const scheme = readWebhookScheme({ GHL_WEBHOOK_SECRET: 'a-shared-secret' } as unknown as NodeJS.ProcessEnv);
  assert.equal(scheme.scheme, 'hmac');
});

test('neither configured still refuses — no development bypass', () => {
  const scheme = readWebhookScheme({} as unknown as NodeJS.ProcessEnv);
  assert.equal(scheme.scheme, 'none');

  const result = verifyInboundWebhook({ rawBody: '{}', signature: 'x', timestamp: '1' }, scheme, NOW);
  assert.equal(result.ok === false && result.reason, 'not_configured');
});

test('verifyRsaSignature reports a key problem as null and a bad signature as false', () => {
  const raw = bodyOf();
  assert.equal(verifyRsaSignature(raw, sign(raw), publicKey), true);
  assert.equal(verifyRsaSignature(raw, sign(raw), 'garbage'), null);
});
