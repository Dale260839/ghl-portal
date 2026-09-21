import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authorizeUrl, oauthEnabled, readOauthConfig, OAUTH_SCOPES } from './oauth-config.ts';
import { exchangeCode, agencyAccessToken } from './oauth-agency.ts';
import { OauthTokenResolver, resetLocationTokens } from './oauth-location.ts';
import type { HubGhlOauth, OauthInstall } from '../hub-db/ghl-oauth.ts';

/**
 * The agency Marketplace install.
 *
 * Every test here is about one of two things: that the install cannot hand back
 * a credential for a sub-account it has no business in, and that a broken
 * install degrades to the Private Integration tokens rather than taking every
 * contractor's API access down with it.
 */

const AFC = 'IifYfP2B2NUaoDPdsTTa';
const APS = 'IyKL37e3QdiFBx5ESI2d';

const ENV = {
  GHL_OAUTH_CLIENT_ID: 'client-1',
  GHL_OAUTH_CLIENT_SECRET: 'secret-1',
  GHL_OAUTH_REDIRECT_URI: 'https://hub.test/api/ghl/oauth/callback',
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
  assert.equal(url.searchParams.get('redirect_uri'), 'https://hub.test/api/ghl/oauth/callback');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.equal(url.searchParams.get('response_type'), 'code');
  // The scopes are the Hub's actual calls and nothing else: an unused scope on
  // an agency-wide install is permission granted for no reason.
  assert.ok(url.searchParams.get('scope')?.includes('invoices.write'));
  assert.equal(OAUTH_SCOPES.includes('payments.write' as never), false);
});

// ── The exchange ────────────────────────────────────────────────────────────

test('§ the code is exchanged for an AGENCY install, form-encoded', async () => {
  let seen: { url: string; body: string; contentType: string } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = {
      url: String(url),
      body: String(init.body),
      contentType: String((init.headers as Record<string, string>)['Content-Type']),
    };
    return new Response(
      JSON.stringify({
        access_token: 'agency-access',
        refresh_token: 'agency-refresh',
        expires_in: 3600,
        companyId: 'comp-1',
        userType: 'Company',
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const tokens = await exchangeCode(config(), 'the-code', { fetchImpl, now: 0 });

  assert.equal(tokens?.accessToken, 'agency-access');
  assert.equal(tokens?.companyId, 'comp-1');
  assert.equal(tokens?.expiresAt, new Date(3600_000).toISOString());
  const call = seen as unknown as { url: string; body: string; contentType: string };
  assert.equal(call.url, 'https://ghl.test/oauth/token');
  // GoHighLevel rejects JSON here with a 422 that explains nothing.
  assert.equal(call.contentType, 'application/x-www-form-urlencoded');
  // `Company`, not `Location`: a Location install is one sub-account, which is
  // the thing we are replacing.
  assert.ok(call.body.includes('user_type=Company'));
  assert.ok(call.body.includes('client_secret=secret-1'));
});

test('a token response missing a refresh token is refused, not half-stored', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ access_token: 'only-access' }), { status: 200 })) as unknown as typeof fetch;
  assert.equal(await exchangeCode(config(), 'c', { fetchImpl }), null);
});

// ── The agency token, and the single writer ─────────────────────────────────

function fakeStore(install: OauthInstall | null, log: string[] = []): HubGhlOauth & { log: string[] } {
  let current = install;
  let claimHeld: string | null = null;
  return {
    log,
    async read() {
      return current;
    },
    async save() {
      return true;
    },
    async claim(_clientId: string, claimId: string) {
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
      claimId: string,
      tokens: { refreshToken: string; accessToken: string; accessExpiresAt: string },
    ) {
      if (claimHeld !== claimId) return false;
      claimHeld = null;
      current =
        current === null
          ? null
          : { ...current, refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt };
      log.push('saved');
      return true;
    },
    async releaseClaim() {
      claimHeld = null;
      log.push('released');
    },
    async saveInstalledLocations() {},
  } as unknown as HubGhlOauth & { log: string[] };
}

const install = (over: Partial<OauthInstall> = {}): OauthInstall => ({
  companyId: 'comp-1',
  clientId: 'client-1',
  refreshToken: 'refresh-1',
  accessToken: null,
  accessExpiresAt: null,
  installedLocations: [],
  installedRefreshedAt: null,
  claimId: null,
  claimedAt: null,
  ...over,
});

test('a token still comfortably valid is reused, with no call to GoHighLevel', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not refresh');
  }) as unknown as typeof fetch;

  const token = await agencyAccessToken({
    config: config(),
    store: fakeStore(install({ accessToken: 'still-good', accessExpiresAt: new Date(3_600_000).toISOString() })),
    fetchImpl,
    now: () => 0,
  });
  assert.equal(token, 'still-good');
});

test('§ a token inside the safety margin is refreshed BEFORE it expires', async () => {
  // Expiring in two minutes is expired as far as this is concerned: a request
  // that starts now must not have its credential die halfway through.
  const store = fakeStore(install({ accessToken: 'nearly-dead', accessExpiresAt: new Date(120_000).toISOString() }));
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({ access_token: 'fresh', refresh_token: 'refresh-2', expires_in: 3600, userType: 'Company' }),
      { status: 200 },
    )) as unknown as typeof fetch;

  const token = await agencyAccessToken({ config: config(), store, fetchImpl, now: () => 0 });
  assert.equal(token, 'fresh');
  assert.deepEqual(store.log, ['claim-taken', 'saved']);
});

test('§ only one instance refreshes; the other waits and takes the winner’s token', async () => {
  // GoHighLevel kills the old refresh token the moment a new one is issued, so
  // two simultaneous refreshes leave one instance holding a dead credential —
  // and that credential is every contractor's API access.
  const store = fakeStore(install());
  let refreshes = 0;
  const fetchImpl = (async () => {
    refreshes += 1;
    return new Response(
      JSON.stringify({ access_token: `fresh-${refreshes}`, refresh_token: 'r2', expires_in: 3600 }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const [a, b] = await Promise.all([
    agencyAccessToken({ config: config(), store, fetchImpl, now: () => 0, sleep: async () => {} }),
    agencyAccessToken({ config: config(), store, fetchImpl, now: () => 0, sleep: async () => {} }),
  ]);

  assert.equal(refreshes, 1, 'the second instance must not start its own refresh');
  // The winner got a token; the loser read the row afterwards and found it.
  assert.ok(a === 'fresh-1' || b === 'fresh-1');
  assert.ok(store.log.includes('claim-refused'));
});

test('§ a refresh that fails gives the claim back, so the next request may try', async () => {
  const store = fakeStore(install());
  const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;

  assert.equal(await agencyAccessToken({ config: config(), store, fetchImpl, now: () => 0 }), null);
  assert.deepEqual(store.log, ['claim-taken', 'released']);
});

test('no install at all is null, not a throw — the caller falls back to the PIT', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  assert.equal(await agencyAccessToken({ config: config(), store: fakeStore(null), fetchImpl }), null);
});

// ── The location resolver: the tenancy boundary ─────────────────────────────

function resolverWith(
  handler: (url: string, init?: RequestInit) => Response,
  installed: OauthInstall | null = install({ accessToken: 'agency-access', accessExpiresAt: new Date(3_600_000).toISOString() }),
) {
  resetLocationTokens();
  const fetchImpl = (async (url: string, init?: RequestInit) => handler(String(url), init)) as unknown as typeof fetch;
  return new OauthTokenResolver({ config: config(), store: fakeStore(installed), fetchImpl, now: () => 0 });
}

test('a sub-account token is minted and reused within its life', async () => {
  let mints = 0;
  const resolver = resolverWith((url) => {
    if (url.endsWith('/oauth/locationToken')) {
      mints += 1;
      return new Response(JSON.stringify({ access_token: 'loc-token', expires_in: 86_400 }), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  });

  assert.equal(await resolver.resolve(AFC), 'loc-token');
  assert.equal(await resolver.resolve(AFC), 'loc-token');
  assert.equal(mints, 1, 'the second call came from the cache');
});

test('§ a location the app is not installed on gets NULL — never another location’s token', async () => {
  // The whole reason D-013 put a resolver here: the fallback for an unresolved
  // location must never be a credential that opens somebody else's data.
  const resolver = resolverWith((url) => {
    if (url.endsWith('/oauth/locationToken')) return new Response('not installed', { status: 401 });
    throw new Error(`unexpected ${url}`);
  });
  assert.equal(await resolver.resolve(APS), null);
});

test('§ a response naming a DIFFERENT location is refused', async () => {
  // If GoHighLevel ever answers with another sub-account, handing that token
  // back would be the exact cross-tenant leak this file exists to prevent.
  const resolver = resolverWith(() =>
    new Response(JSON.stringify({ access_token: 'wrong-token', locationId: APS, expires_in: 86_400 }), {
      status: 200,
    }),
  );
  assert.equal(await resolver.resolve(AFC), null);
});

test('§ a fixture label never reaches the API — no request at all', async () => {
  // Asserted on the REQUEST, not on the answer. A resolver that called
  // GoHighLevel with `loc_alliance_pro` and swallowed the error would return
  // null too, and look identical from the outside.
  let calls = 0;
  const resolver = resolverWith(() => {
    calls += 1;
    return new Response(JSON.stringify({ access_token: 'should-never-happen' }), { status: 200 });
  });
  assert.equal(await resolver.resolve('loc_alliance_pro'), null);
  assert.equal(await resolver.resolve('buildsuite:location-unknown'), null);
  assert.equal(await resolver.resolve(''), null);
  assert.equal(calls, 0, 'a fixture label was sent to the live API');
});

test('a refusal is not re-asked on every request, but is not remembered for long either', async () => {
  let calls = 0;
  const resolver = resolverWith((url) => {
    if (url.endsWith('/oauth/locationToken')) {
      calls += 1;
      return new Response('no', { status: 401 });
    }
    throw new Error(`unexpected ${url}`);
  });

  assert.equal(await resolver.resolve(AFC), null);
  assert.equal(await resolver.resolve(AFC), null);
  assert.equal(calls, 1, 'a refusal is cached briefly');
});

test('with no install there is nothing to mint from', async () => {
  const resolver = resolverWith(() => {
    throw new Error('must not call GHL');
  }, null);
  assert.equal(await resolver.resolve(AFC), null);
});
