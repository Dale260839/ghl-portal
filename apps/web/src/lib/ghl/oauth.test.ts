import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authorizeUrl, oauthEnabled, readOauthConfig, OAUTH_SCOPES } from './oauth-config.ts';
import { exchangeCode, locationAccessToken } from './oauth-tokens.ts';
import { OauthTokenResolver, resetLocationTokens } from './oauth-location.ts';
import type { HubGhlOauth, LocationInstall } from '../hub-db/ghl-oauth.ts';

/**
 * The Marketplace install, one sub-account at a time.
 *
 * Every test here is about one of two things: that an install cannot hand back
 * a credential for a sub-account it has no business in, and that a broken
 * install degrades to the Private Integration tokens rather than taking a
 * contractor's API access down with it.
 */

const AFC = 'IifYfP2B2NUaoDPdsTTa';
const APS = 'IyKL37e3QdiFBx5ESI2d';

const ENV = {
  GHL_OAUTH_CLIENT_ID: 'client-1',
  GHL_OAUTH_CLIENT_SECRET: 'secret-1',
  GHL_OAUTH_REDIRECT_URI: 'https://hub.test/api/connect/callback',
  GHL_API_BASE_URL: 'https://ghl.test',
} as unknown as NodeJS.ProcessEnv;

function config() {
  const result = readOauthConfig(ENV);
  assert.equal(result.configured, true);
  return result.configured ? result.config : (undefined as never);
}

// ── The flag ────────────────────────────────────────────────────────────────

test('§ the switch is off unless it is both set AND fully configured', () => {
  // A flag set against a half-configured app would take every contractor's API
  // access down to prove a typo. An incomplete config reads as "off", not as an
  // error, on purpose.
  assert.equal(oauthEnabled({ ...ENV, GHL_OAUTH_ENABLED: 'true' }), true);
  assert.equal(oauthEnabled({ ...ENV }), false);
  assert.equal(
    oauthEnabled({ GHL_OAUTH_ENABLED: 'true', GHL_OAUTH_CLIENT_ID: 'only-this' } as unknown as NodeJS.ProcessEnv),
    false,
  );
});

test('the authorisation URL carries the app, the return address and the signed state', () => {
  const url = new URL(authorizeUrl(config(), 'signed-state'));
  assert.equal(url.searchParams.get('client_id'), 'client-1');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://hub.test/api/connect/callback');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('response_type'), 'code');
});

test('§ the app asks for what the Hub calls, and nothing more', () => {
  // Every scope here is granted by a contractor over their own CRM. Holding one
  // we never use is permission taken for no reason.
  assert.deepEqual([...OAUTH_SCOPES].sort(), [
    'contacts.readonly',
    'contacts.write',
    'conversations.write',
    'conversations/message.write',
    'invoices.readonly',
    'invoices.write',
    'locations.readonly',
  ]);
  // Objects is deliberately absent: the custom-object data source has never
  // been switched on and needs a tenancy fix before it is.
  assert.equal(
    [...OAUTH_SCOPES].some((s) => s.startsWith('objects/')),
    false,
  );
});

// ── The exchange ────────────────────────────────────────────────────────────

test('§ the code is exchanged for a LOCATION install, form-encoded', async () => {
  let seen: { url: string; body: string; contentType: string } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = {
      url: String(url),
      body: String(init.body),
      contentType: String((init.headers as Record<string, string>)['Content-Type']),
    };
    return new Response(
      JSON.stringify({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 86_400,
        locationId: AFC,
        companyId: 'comp-1',
        userType: 'Location',
        scope: 'invoices.write contacts.readonly',
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const tokens = await exchangeCode(config(), 'the-code', { fetchImpl, now: 0 });

  assert.equal(tokens?.accessToken, 'access-1');
  assert.equal(tokens?.locationId, AFC);
  assert.equal(tokens?.companyId, 'comp-1');
  assert.equal(tokens?.expiresAt, new Date(86_400_000).toISOString());
  const call = seen as unknown as { url: string; body: string; contentType: string };
  assert.equal(call.url, 'https://ghl.test/oauth/token');
  // GoHighLevel rejects JSON here with a 422 that explains nothing.
  assert.equal(call.contentType, 'application/x-www-form-urlencoded');
  // `Location`, not `Company`: the scopes the Hub needs are issued to
  // location-level tokens only — an agency install cannot hold them at all.
  assert.ok(call.body.includes('user_type=Location'));
  assert.ok(call.body.includes('client_secret=secret-1'));
});

test('a token response missing a refresh token is refused, not half-stored', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ access_token: 'only-access' }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await exchangeCode(config(), 'c', { fetchImpl }), null);
});

// ── Keeping one sub-account's token alive ───────────────────────────────────

function fakeStore(install: LocationInstall | null, log: string[] = []): HubGhlOauth & { log: string[] } {
  let current = install;
  let claimHeld: string | null = null;
  return {
    log,
    async read(_clientId: string, locationId: string) {
      return current !== null && current.locationId === locationId ? current : null;
    },
    async save() {
      return true;
    },
    async connectedLocations() {
      return current === null ? [] : [current.locationId];
    },
    async claim(_clientId: string, _locationId: string, claimId: string) {
      if (claimHeld !== null) {
        log.push('claim-refused');
        return false;
      }
      claimHeld = claimId;
      log.push('claim-taken');
      return true;
    },
    async saveRefreshed(
      _clientId: string,
      _locationId: string,
      claimId: string,
      tokens: { refreshToken: string; accessToken: string; accessExpiresAt: string },
    ) {
      if (claimHeld !== claimId) return false;
      claimHeld = null;
      current =
        current === null
          ? null
          : {
              ...current,
              refreshToken: tokens.refreshToken,
              accessToken: tokens.accessToken,
              accessExpiresAt: tokens.accessExpiresAt,
            };
      log.push('saved');
      return true;
    },
    async releaseClaim() {
      claimHeld = null;
      log.push('released');
    },
  } as unknown as HubGhlOauth & { log: string[] };
}

const install = (over: Partial<LocationInstall> = {}): LocationInstall => ({
  locationId: AFC,
  companyId: 'comp-1',
  clientId: 'client-1',
  refreshToken: 'refresh-1',
  accessToken: null,
  accessExpiresAt: null,
  scopes: null,
  claimId: null,
  claimedAt: null,
  ...over,
});

test('a token still comfortably valid is reused, with no call to GoHighLevel', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not refresh');
  }) as unknown as typeof fetch;

  const token = await locationAccessToken(
    {
      config: config(),
      store: fakeStore(install({ accessToken: 'still-good', accessExpiresAt: new Date(3_600_000).toISOString() })),
      fetchImpl,
      now: () => 0,
    },
    AFC,
  );
  assert.equal(token, 'still-good');
});

test('§ a token inside the safety margin is refreshed BEFORE it expires', async () => {
  // Expiring in two minutes is expired as far as this is concerned: a request
  // that starts now must not have its credential die halfway through.
  const store = fakeStore(install({ accessToken: 'nearly-dead', accessExpiresAt: new Date(120_000).toISOString() }));
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 86_400, locationId: AFC }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const token = await locationAccessToken({ config: config(), store, fetchImpl, now: () => 0 }, AFC);
  assert.equal(token, 'fresh');
  assert.deepEqual(store.log, ['claim-taken', 'saved']);
});

test('§ only one instance refreshes a row; the other waits and takes the winner’s token', async () => {
  // GoHighLevel kills the old refresh token the moment a new one is issued, so
  // two simultaneous refreshes of one row leave an instance holding a dead
  // credential — and that is the contractor's whole API access.
  const store = fakeStore(install());
  let refreshes = 0;
  const fetchImpl = (async () => {
    refreshes += 1;
    return new Response(
      JSON.stringify({ access_token: `fresh-${refreshes}`, refresh_token: 'r2', expires_in: 86_400 }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const deps = { config: config(), store, fetchImpl, now: () => 0, sleep: async () => {} };
  const [a, b] = await Promise.all([locationAccessToken(deps, AFC), locationAccessToken(deps, AFC)]);

  assert.equal(refreshes, 1, 'the second instance must not start its own refresh');
  assert.ok(a === 'fresh-1' || b === 'fresh-1');
  assert.ok(store.log.includes('claim-refused'));
});

test('§ a refresh that fails gives the claim back, so the next request may try', async () => {
  const store = fakeStore(install());
  const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;

  assert.equal(await locationAccessToken({ config: config(), store, fetchImpl, now: () => 0 }, AFC), null);
  assert.deepEqual(store.log, ['claim-taken', 'released']);
});

test('§ a refresh answering for a DIFFERENT sub-account is refused and not stored', async () => {
  // Storing another sub-account's token against this row would be a
  // cross-tenant leak with a very long life.
  const store = fakeStore(install());
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ access_token: 'wrong', refresh_token: 'r2', expires_in: 86_400, locationId: APS }),
      { status: 200 },
    )) as unknown as typeof fetch;

  assert.equal(await locationAccessToken({ config: config(), store, fetchImpl, now: () => 0 }, AFC), null);
  assert.deepEqual(store.log, ['claim-taken', 'released']);
});

test('a sub-account with no install is null, not a throw — the caller falls back to the PIT', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  assert.equal(await locationAccessToken({ config: config(), store: fakeStore(null), fetchImpl }, AFC), null);
});

test('§ one sub-account’s install never answers for another', async () => {
  // The store is keyed by location, and the key is the tenant boundary.
  const store = fakeStore(install({ accessToken: 'afc-token', accessExpiresAt: new Date(3_600_000).toISOString() }));
  const fetchImpl = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  const deps = { config: config(), store, fetchImpl, now: () => 0 };

  assert.equal(await locationAccessToken(deps, AFC), 'afc-token');
  assert.equal(await locationAccessToken(deps, APS), null);
});

// ── The resolver: cache, refusals, and the fixture guard ────────────────────

function resolverWith(
  handler: (url: string, init?: RequestInit) => Response,
  installed: LocationInstall | null = install({
    accessToken: 'stored-token',
    accessExpiresAt: new Date(86_400_000).toISOString(),
  }),
  now: () => number = () => 0,
) {
  resetLocationTokens();
  const fetchImpl = (async (url: string, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch;
  return new OauthTokenResolver({ config: config(), store: fakeStore(installed), fetchImpl, now });
}

test('a sub-account token is served from the store, then from cache', async () => {
  const resolver = resolverWith(() => {
    throw new Error('must not call GHL — the stored token is still good');
  });
  assert.equal(await resolver.resolve(AFC), 'stored-token');
  assert.equal(await resolver.resolve(AFC), 'stored-token');
});

test('§ a sub-account the app is not installed on gets NULL — never another one’s token', async () => {
  // The whole reason D-013 put a resolver here: the fallback for an unresolved
  // location must never be a credential that opens somebody else's data.
  const resolver = resolverWith(() => {
    throw new Error('must not call GHL');
  });
  assert.equal(await resolver.resolve(APS), null);
});

test('§ a fixture label is never used as a key — not even looked up', async () => {
  // Asserted on the LOOKUP, not on the answer. `loc_alliance_pro` and
  // `buildsuite:location-unknown` are fixtures, not sub-accounts; returning
  // null for them is not enough, because a resolver that queried the database
  // with one and found nothing would look identical from the outside. Nothing
  // that is not a real GoHighLevel id may become a tenant key.
  let lookups = 0;
  const watching = {
    async read() {
      lookups += 1;
      return null;
    },
  } as unknown as HubGhlOauth;
  resetLocationTokens();
  const resolver = new OauthTokenResolver({ config: config(), store: watching, now: () => 0 });

  assert.equal(await resolver.resolve('loc_alliance_pro'), null);
  assert.equal(await resolver.resolve('buildsuite:location-unknown'), null);
  assert.equal(await resolver.resolve(''), null);
  assert.equal(await resolver.resolve('{{location.id}}'), null);
  assert.equal(lookups, 0, 'a fixture label was used as a sub-account key');
});

test('§ a cached token is never trusted for more than an hour', async () => {
  // A token can die before the expiry it was issued with — the app uninstalled
  // from that sub-account, the install replaced — and nothing tells us. Capping
  // the cache bounds that to an hour instead of a day.
  let clock = 0;
  let reads = 0;
  const store = fakeStore(install({ accessToken: 'stored', accessExpiresAt: new Date(86_400_000).toISOString() }));
  const counting = {
    ...store,
    async read(clientId: string, locationId: string) {
      reads += 1;
      return store.read(clientId, locationId);
    },
  } as unknown as HubGhlOauth;

  const resolver = new OauthTokenResolver({ config: config(), store: counting, now: () => clock });

  assert.equal(await resolver.resolve(AFC), 'stored');
  clock = 59 * 60_000;
  assert.equal(await resolver.resolve(AFC), 'stored');
  assert.equal(reads, 1, 'still cached within the hour');
  clock = 61 * 60_000;
  assert.equal(await resolver.resolve(AFC), 'stored');
  assert.equal(reads, 2, 'past the cap, the row is read again');
});

test('a refusal is not re-asked on every request, but is not remembered for long either', async () => {
  let reads = 0;
  const empty = {
    async read() {
      reads += 1;
      return null;
    },
  } as unknown as HubGhlOauth;
  resetLocationTokens();
  const resolver = new OauthTokenResolver({ config: config(), store: empty, now: () => 0 });

  assert.equal(await resolver.resolve(AFC), null);
  assert.equal(await resolver.resolve(AFC), null);
  assert.equal(reads, 1, 'a refusal is cached briefly');
});
