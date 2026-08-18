/**
 * Verifying a Custom Menu Link landing against the GHL API.
 *
 * The landing gives us a claim, not proof. These tests are about refusing the
 * claim when it doesn't check out — including the case that matters most: a
 * real user id paired with someone else's location.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GhlClient } from '../ghl/client.ts';
import { verifyGhlUser } from './ghl-verify.ts';

const config = {
  baseUrl: 'https://services.leadconnectorhq.com',
  apiVersion: '2021-07-28',
  locationId: 'loc_alliance',
  token: 'pit-test',
  projectObjectKey: 'custom_objects.projects',
};

function clientReturning(body: unknown, status = 200): GhlClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return new GhlClient({ config, fetchImpl, sleep: async () => {}, maxRetries: 0 });
}

const claim = { locationId: 'loc_alliance', userId: 'usr_marcus' };

// ── Refusals ─────────────────────────────────────────────────────────────────

test('a user in a different location is refused — the forged-landing case', async () => {
  const client = clientReturning({
    user: { id: 'usr_marcus', email: 'm@x.com', locationIds: ['loc_someone_else'] },
  });
  const result = await verifyGhlUser(claim, config, client);
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'wrong_location');
});

test('an unresolvable user is refused', async () => {
  const result = await verifyGhlUser(claim, config, clientReturning({ user: {} }));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'unknown_user');
});

test('a lookup failure refuses rather than passing', async () => {
  // An outage must not become an open door.
  const result = await verifyGhlUser(claim, config, clientReturning({}, 500));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'lookup_failed');
});

test('a 401 from GHL also refuses, it does not throw past the caller', async () => {
  const result = await verifyGhlUser(claim, config, clientReturning({}, 401));
  assert.equal(result.verified, false);
  assert.equal(result.verified === false ? result.reason : '', 'lookup_failed');
});

// ── Acceptances ──────────────────────────────────────────────────────────────

test('a user in the claimed location is verified', async () => {
  const client = clientReturning({
    user: {
      id: 'usr_marcus',
      email: 'Marcus@AlliancePro.com',
      name: 'Marcus Reyes',
      locationIds: ['loc_alliance'],
    },
  });
  const result = await verifyGhlUser(claim, config, client);
  assert.ok(result.verified);
  assert.equal(result.user.id, 'usr_marcus');
  assert.equal(result.user.email, 'marcus@alliancepro.com', 'email is normalised for matching');
  assert.equal(result.user.name, 'Marcus Reyes');
});

test('locations are read from roles.locationIds as well', async () => {
  // GHL reports membership in more than one place depending on how the user was
  // created. Reading only one would reject legitimate users, and the failure
  // would look like a security block rather than a parsing bug.
  const client = clientReturning({
    user: { id: 'usr_marcus', email: 'm@x.com', roles: { locationIds: ['loc_alliance'] } },
  });
  assert.ok((await verifyGhlUser(claim, config, client)).verified);
});

test('a user in several locations including the claimed one is verified', async () => {
  const client = clientReturning({
    user: { id: 'usr_marcus', email: 'm@x.com', locationIds: ['loc_other', 'loc_alliance'] },
  });
  assert.ok((await verifyGhlUser(claim, config, client)).verified);
});

test('an unwrapped response is handled — GHL wraps some and not others', async () => {
  const client = clientReturning({
    id: 'usr_marcus',
    email: 'm@x.com',
    locationIds: ['loc_alliance'],
  });
  assert.ok((await verifyGhlUser(claim, config, client)).verified);
});

test('a name is assembled from first and last when there is no name field', async () => {
  const client = clientReturning({
    user: {
      id: 'usr_marcus',
      email: 'm@x.com',
      firstName: 'Marcus',
      lastName: 'Reyes',
      locationIds: ['loc_alliance'],
    },
  });
  const result = await verifyGhlUser(claim, config, client);
  assert.ok(result.verified);
  assert.equal(result.user.name, 'Marcus Reyes');
});

test('a user with no location list at all is accepted', async () => {
  // Single-location tokens see users without a location array. Refusing them
  // would break the common case; the token itself is already scoped to one
  // sub-account, so it cannot return a user from somewhere else.
  const client = clientReturning({ user: { id: 'usr_marcus', email: 'm@x.com' } });
  assert.ok((await verifyGhlUser(claim, config, client)).verified);
});
