/**
 * Webhook verification — the third wire (D4 §3).
 *
 * The load-bearing tests are the refusals. This endpoint will be public, the
 * workflows behind it move money and publish to homeowners, and the payload
 * names the project. Every way in that is not "GHL signed this" has to close.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSeenStore,
  expectedSignature,
  readWebhookConfig,
  verifyWebhook,
  type WebhookConfig,
} from './webhook.ts';
import { mappedEventTypes, routeWebhook } from './webhook-routing.ts';

const SECRET = 'a-shared-secret-from-pat';
const config: WebhookConfig = { secret: SECRET };
const NOW = new Date('2026-08-27T10:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));

function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    webhookId: 'wh_1',
    type: 'OpportunityStageChange',
    locationId: 'IifYfP2B2NUaoDPdsTTa',
    ...over,
  });
}

function signed(raw: string, timestamp = TS) {
  return { rawBody: raw, timestamp, signature: expectedSignature(SECRET, timestamp, raw) };
}

// ── The happy path, so the refusals below mean something ─────────────────────

test('a correctly signed, fresh payload is accepted', () => {
  const result = verifyWebhook(signed(body()), config, NOW);

  assert.ok(result.ok);
  assert.equal(result.event.id, 'wh_1');
  assert.equal(result.event.type, 'OpportunityStageChange');
  assert.equal(result.event.locationId, 'IifYfP2B2NUaoDPdsTTa');
});

// ── Refusals ─────────────────────────────────────────────────────────────────

test('no secret configured refuses — there is no development bypass', () => {
  const result = verifyWebhook(signed(body()), { secret: '' }, NOW);

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'not_configured');
});

test('a missing signature is refused', () => {
  const r = verifyWebhook({ ...signed(body()), signature: null }, config, NOW);
  assert.equal(r.ok === false && r.reason, 'missing_signature');
});

test('a missing timestamp is refused', () => {
  const r = verifyWebhook({ ...signed(body()), timestamp: null }, config, NOW);
  assert.equal(r.ok === false && r.reason, 'missing_timestamp');
});

test('a non-numeric timestamp is refused', () => {
  const raw = body();
  const r = verifyWebhook(
    { rawBody: raw, timestamp: 'yesterday', signature: expectedSignature(SECRET, 'yesterday', raw) },
    config,
    NOW,
  );
  assert.equal(r.ok === false && r.reason, 'bad_timestamp');
});

test('a wrong signature is refused', () => {
  const r = verifyWebhook({ ...signed(body()), signature: 'deadbeef' }, config, NOW);
  assert.equal(r.ok === false && r.reason, 'bad_signature');
});

test('a signature from a different secret is refused', () => {
  const raw = body();
  const r = verifyWebhook(
    { rawBody: raw, timestamp: TS, signature: expectedSignature('someone-elses-secret', TS, raw) },
    config,
    NOW,
  );
  assert.equal(r.ok === false && r.reason, 'bad_signature');
});

test('changing one byte of the body invalidates the signature', () => {
  const original = body();
  const request = signed(original);
  // Same signature, tampered body — the shape of an intercepted request.
  const tampered = { ...request, rawBody: original.replace('IifYfP2B2NUaoDPdsTTa', 'someoneElse') };

  const r = verifyWebhook(tampered, config, NOW);
  assert.equal(r.ok === false && r.reason, 'bad_signature');
});

// ── Replay ───────────────────────────────────────────────────────────────────

test('a payload older than the tolerance is refused', () => {
  const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
  const r = verifyWebhook(signed(body(), old), config, NOW);

  assert.equal(r.ok === false && r.reason, 'stale');
});

test('a payload from the future is refused too', () => {
  // A clock skewed forward would otherwise widen the replay window indefinitely.
  const future = String(Math.floor(NOW.getTime() / 1000) + 3600);
  const r = verifyWebhook(signed(body(), future), config, NOW);

  assert.equal(r.ok === false && r.reason, 'stale');
});

test('a payload inside the tolerance is accepted', () => {
  const recent = String(Math.floor(NOW.getTime() / 1000) - 120);
  assert.equal(verifyWebhook(signed(body(), recent), config, NOW).ok, true);
});

test('the same event id is accepted once and refused after', () => {
  const seen = createSeenStore();
  const request = signed(body());

  assert.equal(verifyWebhook(request, config, NOW, seen).ok, true);

  const replayed = verifyWebhook(request, config, NOW, seen);
  assert.equal(replayed.ok === false && replayed.reason, 'replayed');
});

test('a different event id is not blocked by a previous one', () => {
  const seen = createSeenStore();
  verifyWebhook(signed(body()), config, NOW, seen);

  assert.equal(verifyWebhook(signed(body({ webhookId: 'wh_2' })), config, NOW, seen).ok, true);
});

test('the seen store stays bounded', () => {
  const seen = createSeenStore(3);
  for (const id of ['a', 'b', 'c', 'd']) seen.add(id);

  assert.equal(seen.has('a'), false, 'the oldest id should have been evicted');
  assert.equal(seen.has('d'), true);
});

// ── Body handling ────────────────────────────────────────────────────────────

test('a body that is not JSON is refused — and only after the signature passes', () => {
  const raw = 'not json at all';
  const r = verifyWebhook(signed(raw), config, NOW);

  // The signature was valid, so we got as far as parsing. That ordering is the
  // point: we never parse bytes from an unauthenticated source.
  assert.equal(r.ok === false && r.reason, 'malformed_body');
});

test('a JSON array is refused', () => {
  const r = verifyWebhook(signed('[1,2,3]'), config, NOW);
  assert.equal(r.ok === false && r.reason, 'malformed_body');
});

test('a payload with no event id is refused', () => {
  const raw = JSON.stringify({ type: 'OpportunityStageChange', locationId: 'x' });
  const r = verifyWebhook(signed(raw), config, NOW);
  assert.equal(r.ok === false && r.reason, 'malformed_body');
});

test('alternative id and type field names are accepted', () => {
  // GHL's exact payload shape is unconfirmed; the reader tries the likely names.
  const raw = JSON.stringify({ id: 'evt_9', event: 'DailyUpdateCreated', location_id: 'loc_1' });
  const r = verifyWebhook(signed(raw), config, NOW);

  assert.ok(r.ok);
  assert.equal(r.event.id, 'evt_9');
  assert.equal(r.event.locationId, 'loc_1');
});

// ── Config ───────────────────────────────────────────────────────────────────

test('an empty or whitespace secret counts as unconfigured', () => {
  for (const secret of ['', '   ', undefined]) {
    const result = readWebhookConfig({ GHL_WEBHOOK_SECRET: secret } as unknown as NodeJS.ProcessEnv);
    assert.equal(result.configured, false);
  }

  assert.equal(
    readWebhookConfig({ GHL_WEBHOOK_SECRET: SECRET } as unknown as NodeJS.ProcessEnv).configured,
    true,
  );
});

// ── Routing ──────────────────────────────────────────────────────────────────

const event = (type: string, locationId: string | null = 'loc_1') => ({
  id: 'wh_1',
  type,
  locationId,
  raw: {},
});

test('a stage change routes to WF2', () => {
  const r = routeWebhook(event('OpportunityStageChange'));
  assert.ok(r.handled);
  assert.equal(r.workflow, 'WF2');
});

test('event type matching tolerates case and separators', () => {
  for (const type of ['OpportunityStageChange', 'opportunity.stage.change', 'OPPORTUNITY_STAGE_CHANGE']) {
    const r = routeWebhook(event(type));
    assert.ok(r.handled, `${type} should route`);
    assert.equal(r.workflow, 'WF2');
  }
});

test('an unmapped event is accepted and ignored, not refused', () => {
  const r = routeWebhook(event('SomeFutureGhlEvent'));

  // handled:false means "no workflow", not "reject". The route answers 200 —
  // 4xx on an unknown type gets the whole webhook disabled by whoever is
  // watching the delivery log.
  assert.equal(r.handled, false);
  assert.match(r.why, /no workflow is mapped/);
});

test('a verified event with no location is not routed', () => {
  const r = routeWebhook(event('OpportunityStageChange', null));

  assert.equal(r.handled, false);
  assert.match(r.why, /no locationId/);
});

test('every mapped type routes to a workflow', () => {
  const types = mappedEventTypes();
  assert.ok(types.length > 0);

  for (const type of types) {
    assert.equal(routeWebhook(event(type)).handled, true, `${type} is mapped but does not route`);
  }
});
