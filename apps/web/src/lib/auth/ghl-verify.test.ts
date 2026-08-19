/**
 * Verifying a Custom Menu Link landing against the GHL API.
 *
 * The landing gives us a location id and nothing else — the same single
 * parameter BuildSuite's own menu link sends. These tests are about refusing
 * that claim when it doesn't check out, because an unverified location id is a
 * choice of whose data to receive.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GhlClient } from '../ghl/client.ts';
import { verifyGhlLocation } from './ghl-verify.ts';

const config = {
  baseUrl: 'https://services.leadconnectorhq.com',
  apiVersion: '2021-07-28',
  locationId: 'IifYfP2B2NUaoDPdsTTa',
  token: 'pit-test',
  projectObjectKey: 'custom_objects.projects',
};

const LOCATION = 'IifYfP2B2NUaoDPdsTTa';

function clientReturning(body: unknown, status = 200): GhlClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return new GhlClient({ config, fetchImpl, sleep: async () => {}, maxRetries: 0 });
}

// ── Refusals ─────────────────────────────────────────────────────────────────

test('a location our token cannot see is refused', async () => {
  // The forged-landing case: someone substitutes another agency's id.
  const result = await verifyGhlLocation(LOCATION, config, clientReturning({}, 404));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'lookup_failed');
});

test('an empty response is refused, not treated as success', async () => {
  const result = await verifyGhlLocation(LOCATION, config, clientReturning({ location: {} }));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'unknown_location');
});

test('a blank location id never reaches the API', async () => {
  for (const blank of ['', '   ']) {
    const result = await verifyGhlLocation(blank, config, clientReturning({ id: 'x' }));
    assert.equal(result.verified, false);
    assert.equal(result.verified === false ? result.reason : '', 'unknown_location');
  }
});

test('a GHL outage refuses rather than passing', async () => {
  // An outage must not become an open door.
  const result = await verifyGhlLocation(LOCATION, config, clientReturning({}, 500));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'lookup_failed');
});

test('a 401 refuses and does not throw past the caller', async () => {
  const result = await verifyGhlLocation(LOCATION, config, clientReturning({}, 401));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'lookup_failed');
});

// ── Acceptances ──────────────────────────────────────────────────────────────

test('a real location is verified and its name returned', async () => {
  const client = clientReturning({
    location: { id: LOCATION, name: 'Alliance For Contractors' },
  });
  const result = await verifyGhlLocation(LOCATION, config, client);
  assert.ok(result.verified);
  assert.equal(result.name, 'Alliance For Contractors');
});

test('an unwrapped response works — GHL wraps some and not others', async () => {
  const client = clientReturning({ id: LOCATION, name: 'Alliance For Contractors' });
  const result = await verifyGhlLocation(LOCATION, config, client);
  assert.ok(result.verified);
  assert.equal(result.name, 'Alliance For Contractors');
});

test('a location with no name still verifies', async () => {
  // The name is decoration; the id is the thing being proven.
  const result = await verifyGhlLocation(LOCATION, config, clientReturning({ id: LOCATION }));
  assert.ok(result.verified);
  assert.equal(result.name, '');
});
