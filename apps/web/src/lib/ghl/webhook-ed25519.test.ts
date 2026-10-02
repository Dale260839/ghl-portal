import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  createSeenStore, readWebhookScheme, verifyEd25519Signature,
  verifyEd25519Webhook, verifyInboundWebhook,
} from './webhook.ts';

const keys = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const NOW = new Date('2026-10-02T05:00:00Z');
const config = { publicKey: keys.publicKey };
const payload = (stage = 'stage-one') => JSON.stringify({
  type: 'OpportunityStageUpdate', id: 'opportunity-one', locationId: 'location-one',
  pipelineStageId: stage, dateAdded: '2021-11-26T12:41:02.193Z',
});
const signed = (rawBody: string) => ({ rawBody, signature: sign(null, Buffer.from(rawBody), keys.privateKey).toString('base64'), timestamp: null });

test('current native signature verifies raw bytes with an isolated Ed25519 keypair', () => {
  const request = signed(payload());
  assert.equal(verifyEd25519Signature(request.rawBody, request.signature, keys.publicKey), true);
  assert.equal(verifyEd25519Webhook(request, config, NOW).ok, true);
});

test('tampering, a wrong key, missing signature and invalid PEM fail closed', () => {
  const request = signed(payload());
  const other = generateKeyPairSync('ed25519');
  assert.equal(verifyEd25519Webhook({ ...request, rawBody: payload('tampered') }, config, NOW).ok, false);
  assert.equal(verifyEd25519Webhook({ ...request, signature: sign(null, Buffer.from(request.rawBody), other.privateKey).toString('base64') }, config, NOW).ok, false);
  assert.equal(verifyEd25519Webhook({ ...request, signature: null }, config, NOW).ok, false);
  assert.equal(verifyEd25519Signature(request.rawBody, request.signature, 'invalid-key'), null);
});

test('an RSA key cannot be misconfigured as the Ed25519 verifier', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const request = signed(payload());
  assert.equal(verifyEd25519Signature(request.rawBody, request.signature, rsa.publicKey), null);
});

test('updates to one native resource are distinct deliveries, while identical bytes replay', () => {
  const seen = createSeenStore();
  const first = verifyEd25519Webhook(signed(payload('stage-one')), config, NOW, seen);
  const second = verifyEd25519Webhook(signed(payload('stage-two')), config, NOW, seen);
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.event.id, second.event.id);
  assert.notEqual(first.event.id, 'opportunity-one');
  const replay = verifyEd25519Webhook(signed(payload('stage-one')), config, NOW, seen);
  assert.equal(replay.ok === false && replay.reason, 'replayed');
});

test('native record creation dates are not treated as webhook delivery dates', () => {
  assert.equal(verifyEd25519Webhook(signed(payload()), config, NOW).ok, true);
  const stale = signed(JSON.stringify({ type: 'OpportunityStageUpdate', id: 'resource', locationId: 'location', webhookTimestamp: '2020-01-01T00:00:00Z' }));
  const result = verifyEd25519Webhook(stale, config, NOW);
  assert.equal(result.ok === false && result.reason, 'stale');
});

test('native delivery metadata is required even though the resource id is not a replay id', () => {
  for (const raw of ['[]', '{}', '{', JSON.stringify({type:'OpportunityStageUpdate'})]) {
    const result = verifyEd25519Webhook(signed(raw), config, NOW);
    assert.equal(result.ok === false && result.reason, 'malformed_body');
  }
});

test('current key takes precedence and missing header-specific keys never downgrade', () => {
  const env = { NODE_ENV: 'test' as const, GHL_WEBHOOK_ED25519_PUBLIC_KEY: keys.publicKey.replace(/\n/g, '\\n'), GHL_WEBHOOK_PUBLIC_KEY: 'legacy-key', GHL_WEBHOOK_SECRET: 'relay-only-fixture' };
  const scheme = readWebhookScheme(env);
  assert.equal(scheme.scheme, 'ghl-ed25519');
  assert.equal(verifyInboundWebhook(signed(payload()), scheme, NOW).ok, true);
  assert.equal(readWebhookScheme({NODE_ENV:'test',GHL_WEBHOOK_SECRET:'relay'}, 'ghl-ed25519').scheme, 'none');
  assert.equal(readWebhookScheme({NODE_ENV:'test',GHL_WEBHOOK_SECRET:'relay'}, 'ghl').scheme, 'none');
  assert.equal(readWebhookScheme(env, 'hmac').scheme, 'hmac');
});
