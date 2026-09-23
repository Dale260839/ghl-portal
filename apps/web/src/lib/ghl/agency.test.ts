import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  agencyAuthorizeUrl,
  agencyEnabled,
  readAgencyConfig,
  AGENCY_SCOPES,
  OAUTH_SCOPES,
} from './oauth-config.ts';
import { agencyAccessToken, exchangeAgencyCode } from './agency-token.ts';
import type { AgencyInstall, HubGhlAgency } from '../hub-db/ghl-agency.ts';

/**
 * The agency install — the credential that lets any contractor sign in.
 *
 * It reaches every sub-account in the agency, which is what makes it useful and
 * what makes it the one to be careful with. These tests are about keeping it
 * narrow, keeping its rotation safe, and making sure a failure costs a fallback
 * rather than a locked door.
 */

const ENV = {
  GHL_AGENCY_CLIENT_ID: 'agency-client',
  GHL_AGENCY_CLIENT_SECRET: 'agency-secret',
  GHL_AGENCY_REDIRECT_URI: 'https://hub.test/api/connect/agency/callback',
  GHL_API_BASE_URL: 'https://ghl.test',
} as unknown as NodeJS.ProcessEnv;

function config() {
  const result = readAgencyConfig(ENV);
  assert.equal(result.configured, true);
  return result.configured ? result.config : (undefined as never);
}

test('§ the agency app holds ONE scope, and it is not the sub-account app’s', () => {
  // Anything added here is granted across every sub-account at once, so the bar
  // is not "might be useful" — it is "sign-in cannot work without it".
  assert.deepEqual([...AGENCY_SCOPES], ['locations.readonly']);
  for (const wide of ['contacts.write', 'invoices.write', 'conversations/message.write']) {
    assert.equal([...AGENCY_SCOPES].includes(wide as never), false);
    // …and those still belong to the sub-account app, which is the point of
    // there being two.
    assert.ok([...OAUTH_SCOPES].includes(wide as never));
  }
});

test('§ the agency switch is separate from the one that moves the work', () => {
  // Rolling back which credential sends invoices must not also take away the
  // thing that lets people sign in. Separate decisions, separate failures.
  assert.equal(agencyEnabled({ ...ENV, GHL_AGENCY_ENABLED: 'true' }), true);
  assert.equal(agencyEnabled({ ...ENV, GHL_OAUTH_ENABLED: 'true' }), false);
  assert.equal(
    agencyEnabled({ GHL_AGENCY_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv),
    false,
    'a half-configured agency app is off, not broken',
  );
});

test('the authorisation URL asks for the agency app and its one scope', () => {
  const url = new URL(agencyAuthorizeUrl(config(), 'signed'));
  assert.equal(url.searchParams.get('client_id'), 'agency-client');
  assert.equal(url.searchParams.get('scope'), 'locations.readonly');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://hub.test/api/connect/agency/callback');
});

test('§ the install is exchanged as a COMPANY, or it cannot see anything else', async () => {
  let body = '';
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return new Response(
      JSON.stringify({
        access_token: 'agency-access',
        refresh_token: 'agency-refresh',
        expires_in: 3600,
        companyId: 'comp-1',
        userType: 'Company',
        scope: 'locations.readonly',
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const tokens = await exchangeAgencyCode(config(), 'code', { fetchImpl, now: 0 });
  assert.equal(tokens?.companyId, 'comp-1');
  assert.equal(tokens?.userType, 'Company');
  // A Location install holds one sub-account and cannot read the others, which
  // is the entire reason this app exists.
  assert.ok(body.includes('user_type=Company'));
});

// ── Rotation, which matters more here than anywhere ────────────────────────

function fakeStore(install: AgencyInstall | null, log: string[] = []): HubGhlAgency & { log: string[] } {
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
  } as unknown as HubGhlAgency & { log: string[] };
}

const install = (over: Partial<AgencyInstall> = {}): AgencyInstall => ({
  companyId: 'comp-1',
  clientId: 'agency-client',
  refreshToken: 'refresh-1',
  accessToken: null,
  accessExpiresAt: null,
  scopes: null,
  ...over,
});

test('a token still comfortably valid is reused, with no call to GoHighLevel', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not refresh');
  }) as unknown as typeof fetch;

  const token = await agencyAccessToken({
    config: config(),
    store: fakeStore(install({ accessToken: 'good', accessExpiresAt: new Date(3_600_000).toISOString() })),
    fetchImpl,
    now: () => 0,
  });
  assert.equal(token, 'good');
});

test('§ only one instance refreshes; two would lock out the whole agency', async () => {
  // This is the credential everybody signs in with. Two simultaneous refreshes
  // leave one instance holding a dead token, and that is not one contractor's
  // invoices — it is everyone's front door.
  const store = fakeStore(install());
  let refreshes = 0;
  const fetchImpl = (async () => {
    refreshes += 1;
    return new Response(
      JSON.stringify({ access_token: `fresh-${refreshes}`, refresh_token: 'r2', expires_in: 3600 }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const deps = { config: config(), store, fetchImpl, now: () => 0, sleep: async () => {} };
  const [a, b] = await Promise.all([agencyAccessToken(deps), agencyAccessToken(deps)]);

  assert.equal(refreshes, 1);
  assert.ok(a === 'fresh-1' || b === 'fresh-1');
  assert.ok(store.log.includes('claim-refused'));
});

test('§ a failed refresh releases the claim and returns null, never throws', async () => {
  // Sign-in falls back to the credential it used before. A broken agency
  // install must never be the reason a contractor cannot open the Hub.
  const store = fakeStore(install());
  const fetchImpl = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;

  assert.equal(await agencyAccessToken({ config: config(), store, fetchImpl, now: () => 0 }), null);
  assert.deepEqual(store.log, ['claim-taken', 'released']);
});

test('no agency install is null, not a throw', async () => {
  const fetchImpl = (async () => {
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  assert.equal(await agencyAccessToken({ config: config(), store: fakeStore(null), fetchImpl }), null);
});
