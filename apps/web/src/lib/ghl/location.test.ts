/**
 * Multi-tenant location scoping (D-013).
 *
 * The Hub is one deployment serving many GHL sub-accounts. The failure this
 * guards against is the quiet one: a resolver that happily hands out the
 * development token for *any* location works perfectly with one sub-account and
 * serves tenant A's credential to tenant B the moment there are two.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DevelopmentTokenResolver,
  LocationScopeError,
  developmentResolver,
  resolveLocation,
  type TokenResolver,
} from './location.ts';

const LOC_A = 'loc_aaa111';
const LOC_B = 'loc_bbb222';
const config = {
  baseUrl: 'https://services.leadconnectorhq.com',
  apiVersion: '2021-07-28',
  locationId: LOC_A,
  token: 'pit-dev',
  projectObjectKey: 'custom_objects.projects',
};

// ── Failing closed ───────────────────────────────────────────────────────────

test('a session with no locationId cannot read anything', async () => {
  const resolver = new DevelopmentTokenResolver(LOC_A, 'pit-dev');
  for (const bad of [undefined, null, '', '   ']) {
    await assert.rejects(() => resolveLocation(bad, resolver), LocationScopeError);
  }
});

test('the dev resolver refuses a location it was not configured for', async () => {
  const resolver = new DevelopmentTokenResolver(LOC_A, 'pit-dev');
  assert.equal(await resolver.resolve(LOC_A), 'pit-dev');
  assert.equal(
    await resolver.resolve(LOC_B),
    null,
    'handing the build token to another sub-account is the whole failure mode',
  );
});

test('an unresolvable location throws and names the location and resolver', async () => {
  const resolver = new DevelopmentTokenResolver(LOC_A, 'pit-dev');
  try {
    await resolveLocation(LOC_B, resolver);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof LocationScopeError);
    assert.match(error.message, new RegExp(LOC_B));
    assert.match(error.message, /development/);
  }
});

// ── The happy path carries both halves ───────────────────────────────────────

test('a resolved context carries the location AND its own credential', async () => {
  const context = await resolveLocation(LOC_A, new DevelopmentTokenResolver(LOC_A, 'pit-dev'));
  assert.deepEqual(context, { locationId: LOC_A, token: 'pit-dev' });
});

test('two locations resolve to two different credentials', async () => {
  // What the OAuth resolver will do — proving the seam holds before it exists.
  const oauth: TokenResolver = {
    kind: 'oauth',
    async resolve(locationId) {
      return { [LOC_A]: 'token-a', [LOC_B]: 'token-b' }[locationId] ?? null;
    },
  };

  const a = await resolveLocation(LOC_A, oauth);
  const b = await resolveLocation(LOC_B, oauth);
  assert.notEqual(a.token, b.token);
  assert.equal(a.token, 'token-a');
  assert.equal(b.token, 'token-b');
  await assert.rejects(() => resolveLocation('loc_unknown', oauth), LocationScopeError);
});

test('swapping the resolver changes nothing above it', async () => {
  // The point of the interface: dev today, OAuth later, same call site.
  const resolvers: TokenResolver[] = [
    new DevelopmentTokenResolver(LOC_A, 'pit-dev'),
    { kind: 'oauth', resolve: async (id) => (id === LOC_A ? 'oauth-token' : null) },
  ];
  for (const resolver of resolvers) {
    const context = await resolveLocation(LOC_A, resolver);
    assert.equal(context.locationId, LOC_A);
    assert.ok(context.token.length > 0);
  }
});

// ── Config default ───────────────────────────────────────────────────────────

test('with no development location configured there is no resolver at all', () => {
  assert.equal(developmentResolver(config, undefined), null);
  assert.equal(developmentResolver(config, '   '), null);
});

test('the development default is a convenience, not a global location', async () => {
  const resolver = developmentResolver(config, LOC_A);
  assert.ok(resolver !== null);
  assert.equal(await resolver.resolve(LOC_A), config.token);
  // It does not become "the" location for everyone else.
  assert.equal(await resolver.resolve(LOC_B), null);
});
