import { test } from 'node:test';
import assert from 'node:assert/strict';

import { configForLocation, resetResolvedConfig } from './resolve-config.ts';
import { resetLocationTokens } from './oauth-location.ts';
import { withLocationToken, type GhlConfig } from './config.ts';
import { resetHubClient } from '../hub-db/client.ts';
import { resetColumnSupport } from '../hub-db/column-support.ts';

/**
 * Which credential a request ends up using.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE IS THE ROLLBACK, EXPRESSED AS TESTS
 *
 * The promise made in docs/ROLLBACK-GHL-OAUTH.md is that unsetting one
 * environment variable restores the behaviour of 2026-09-22 with no deploy and
 * no database change. The first test asserts exactly that, by comparing against
 * `withLocationToken` itself rather than against a copied expectation — so if
 * the old path ever changes, this test follows it instead of going stale.
 * ---------------------------------------------------------------------------
 */

const AFC = 'IifYfP2B2NUaoDPdsTTa';
const APS = 'IyKL37e3QdiFBx5ESI2d';

const base: GhlConfig = {
  baseUrl: 'https://ghl.test',
  apiVersion: '2021-07-28',
  token: 'default-pit',
  locationId: '',
  projectObjectKey: '',
};

const OAUTH_ENV = {
  GHL_OAUTH_CLIENT_ID: 'client-1',
  GHL_OAUTH_CLIENT_SECRET: 'secret-1',
  GHL_OAUTH_REDIRECT_URI: 'https://hub.test/api/connect/callback',
  GHL_API_BASE_URL: 'https://ghl.test',
};

/** The per-sub-account tokens as they are configured today. */
const PIT_ENV = { GHL_LOCATION_TOKENS: `${AFC}:afc-pit,${APS}:aps-pit` } as unknown as NodeJS.ProcessEnv;

function clean(): void {
  resetResolvedConfig();
  resetLocationTokens();
  resetHubClient();
  resetColumnSupport();
}

test('§ with the switch off, this IS withLocationToken — the rollback needs no deploy', async () => {
  clean();
  for (const location of [AFC, APS, 'loc_fixture', '']) {
    const resolved = await configForLocation(base, location, PIT_ENV);
    assert.deepEqual(resolved, withLocationToken(base, location, PIT_ENV));
  }
  // And the untouched default: a sub-account with no entry keeps the behaviour
  // it had yesterday, which is the default token and a 401 it can act on.
  assert.equal((await configForLocation(base, 'kL9ozQ3dTdKcwMfUeXtY', PIT_ENV)).token, 'default-pit');
});

test('§ the switch on but the app half-configured is still the old path, not an outage', async () => {
  clean();
  const half = { ...PIT_ENV, GHL_OAUTH_ENABLED: 'true', GHL_OAUTH_CLIENT_ID: 'client-1' } as unknown as NodeJS.ProcessEnv;
  assert.equal((await configForLocation(base, AFC, half)).token, 'afc-pit');
});

test('§ the switch on and the Hub unreachable falls back to the PIT, loudly', async () => {
  clean();
  const previous = { url: process.env.HUB_SUPABASE_URL, key: process.env.HUB_SUPABASE_KEY };
  delete process.env.HUB_SUPABASE_URL;
  delete process.env.HUB_SUPABASE_KEY;

  const env = { ...PIT_ENV, ...OAUTH_ENV, GHL_OAUTH_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv;
  try {
    // The install lives in the Hub. No Hub, no install — and a contractor's
    // invoices must not stop because a database is briefly unreachable.
    assert.equal((await configForLocation(base, AFC, env)).token, 'afc-pit');
  } finally {
    if (previous.url !== undefined) process.env.HUB_SUPABASE_URL = previous.url;
    if (previous.key !== undefined) process.env.HUB_SUPABASE_KEY = previous.key;
    clean();
  }
});

// ── The whole chain, against a stand-in Hub and GoHighLevel ─────────────────

interface FakeOptions {
  /** 0016 has not been run. */
  tableMissing?: boolean;
  /** The app is installed nowhere at all. */
  notInstalled?: boolean;
}

function installedRow() {
  return {
    location_id: AFC,
    company_id: 'comp-1',
    client_id: 'client-1',
    refresh_token: 'refresh-1',
    access_token: 'stored-token',
    access_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    scopes: null,
    claim_id: null,
    claimed_at: null,
  };
}

async function withFakeWorld<T>(options: FakeOptions, run: () => Promise<T>): Promise<T> {
  const saved = { ...process.env };
  Object.assign(process.env, {
    HUB_SUPABASE_URL: 'https://hub.test',
    HUB_SUPABASE_KEY: 'sb_secret_test',
    ...OAUTH_ENV,
    GHL_OAUTH_ENABLED: 'true',
  });
  clean();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/rest/v1/hub_ghl_oauth')) {
      if (options.tableMissing) return new Response('relation does not exist', { status: 404 });
      if (url.includes('limit=0')) return new Response('[]', { status: 200 });
      // The store filters on the sub-account, so a location with no install
      // reads back nothing — exactly as the database would answer.
      const wanted = /location_id=eq\.([A-Za-z0-9]+)/.exec(url)?.[1];
      const rows = !options.notInstalled && wanted === AFC ? [installedRow()] : [];
      return new Response(JSON.stringify(rows), { status: 200 });
    }

    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    clean();
  }
}

test('§ installed and fully configured, but NOT switched on: nothing changes', async () => {
  // The state between clicking Install and deciding to use it, which is where
  // this deployment will sit for days. The app is configured, the install is in
  // the database, and every request must still go out on the token it went out
  // on yesterday — without so much as asking GoHighLevel.
  await withFakeWorld({}, async () => {
    const off = { ...process.env, ...PIT_ENV } as unknown as NodeJS.ProcessEnv;
    delete off.GHL_OAUTH_ENABLED;
    const resolved = await configForLocation(base, AFC, off);
    assert.equal(resolved.token, 'afc-pit');
    assert.deepEqual(resolved, withLocationToken(base, AFC, off));
  });
});

test('§ switched on and installed: the sub-account’s own token, not the PIT', async () => {
  await withFakeWorld({}, async () => {
    const resolved = await configForLocation(base, AFC, process.env);
    assert.equal(resolved.token, 'stored-token');
    assert.equal(resolved.locationId, AFC);
  });
});

test('§ switched on, but 0016 has not been run: the PIT, and nothing breaks', async () => {
  // Migrations are run by hand and code ships on push, so the app is routinely
  // ahead of the database. That window must be uneventful.
  await withFakeWorld({ tableMissing: true }, async () => {
    assert.equal((await configForLocation(base, AFC, { ...process.env, ...PIT_ENV })).token, 'afc-pit');
  });
});

test('§ switched on, but not installed on THIS sub-account: that contractor’s own PIT', async () => {
  // AFC is connected, APS is not. The one that is not must not borrow the
  // one that is — it falls back to its own Private Integration token.
  await withFakeWorld({}, async () => {
    assert.equal((await configForLocation(base, APS, { ...process.env, ...PIT_ENV })).token, 'aps-pit');
  });
});

test('a sub-account with neither an install nor a PIT is left exactly as it is today', async () => {
  // Which is the default token and a 401 that names the problem. Inventing a
  // credential here would be a cross-tenant leak; inventing silence would be a
  // contractor believing an invoice went out.
  await withFakeWorld({}, async () => {
    assert.equal((await configForLocation(base, APS, process.env)).token, 'default-pit');
  });
});
