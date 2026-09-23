import 'server-only';

import { randomUUID } from 'node:crypto';

import type { GhlOauthConfig } from './oauth-config.ts';
import { readAgencyConfig, agencyEnabled } from './oauth-config.ts';
import { getHubGhlAgency, type HubGhlAgency, type AgencyInstall } from '../hub-db/ghl-agency.ts';

/**
 * The agency access token — the credential that lets any contractor sign in.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND ONLY FOR
 *
 * Proving a sub-account at sign-in: one call, `GET /locations/{id}`. The app it
 * belongs to holds one scope, `locations.readonly`, so there is nothing else it
 * could do — but the discipline is the point, because this is the one
 * credential in the system that reaches every sub-account in the agency.
 *
 * The rotation hazard is the same as everywhere else and worse in consequence:
 * GoHighLevel issues a new refresh token on every refresh and kills the old, so
 * two instances refreshing together would leave one holding a dead credential —
 * and this one is how *everybody* signs in. Hence the database claim.
 *
 * Every failure returns null and sign-in falls back to the credential it used
 * before: the sub-account's own token, or its Private Integration token. A
 * broken agency install must never be the reason a contractor cannot open the
 * Hub.
 * ---------------------------------------------------------------------------
 */

const EXPIRY_SKEW_MS = 5 * 60_000;
const CLAIM_STALE_MS = 60_000;
const LOSER_WAIT_MS = 1_500;

export interface AgencyTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  companyId: string;
  userType: string;
  scopes: string;
}

interface RawToken {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  companyId?: unknown;
  userType?: unknown;
  scope?: unknown;
}

function parseToken(raw: RawToken, now: number): AgencyTokenResponse | null {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : '';
  if (accessToken === '' || refreshToken === '') return null;

  const seconds =
    typeof raw.expires_in === 'number' && Number.isFinite(raw.expires_in) ? raw.expires_in : 3600;

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(now + seconds * 1000).toISOString(),
    companyId: typeof raw.companyId === 'string' ? raw.companyId : '',
    userType: typeof raw.userType === 'string' ? raw.userType : '',
    scopes: typeof raw.scope === 'string' ? raw.scope : '',
  };
}

async function postToken(
  config: GhlOauthConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  now: number,
): Promise<AgencyTokenResponse | null> {
  const response = await fetchImpl(`${config.apiBase}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...body,
    }).toString(),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error(`[ghl-agency] token endpoint refused: ${response.status} ${detail.slice(0, 200)}`);
    return null;
  }

  const parsed = parseToken((await response.json()) as RawToken, now);
  if (parsed === null) console.error('[ghl-agency] token response carried no usable tokens');
  return parsed;
}

/**
 * The install handshake. `user_type: 'Company'` — an agency install, which is
 * the only kind that can read a sub-account it was never installed on.
 */
export function exchangeAgencyCode(
  config: GhlOauthConfig,
  code: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<AgencyTokenResponse | null> {
  return postToken(
    config,
    {
      grant_type: 'authorization_code',
      code,
      user_type: 'Company',
      redirect_uri: config.redirectUri,
    },
    options.fetchImpl ?? fetch,
    options.now ?? Date.now(),
  );
}

export interface AgencyTokenDeps {
  config: GhlOauthConfig;
  store: HubGhlAgency;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function fresh(install: AgencyInstall, now: number): string | null {
  if (install.accessToken === null || install.accessExpiresAt === null) return null;
  const expires = Date.parse(install.accessExpiresAt);
  if (Number.isNaN(expires)) return null;
  return expires - EXPIRY_SKEW_MS > now ? install.accessToken : null;
}

export async function agencyAccessToken(deps: AgencyTokenDeps): Promise<string | null> {
  const { config, store } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const install = await store.read(config.clientId);
  if (install === null) return null;

  const existing = fresh(install, now());
  if (existing !== null) return existing;

  const claimId = randomUUID();
  if (!(await store.claim(config.clientId, claimId, CLAIM_STALE_MS))) {
    await sleep(LOSER_WAIT_MS);
    const after = await store.read(config.clientId);
    return after === null ? null : fresh(after, now());
  }

  try {
    const tokens = await postToken(
      config,
      { grant_type: 'refresh_token', refresh_token: install.refreshToken, user_type: 'Company' },
      fetchImpl,
      now(),
    );

    if (tokens === null) {
      await store.releaseClaim(config.clientId, claimId);
      return null;
    }

    const saved = await store.saveRefreshed(config.clientId, claimId, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.expiresAt,
    });

    if (!saved) {
      console.error(
        '[ghl-agency] refreshed the agency token but could not store it — the claim was taken. ' +
          'If sign-in starts failing across sub-accounts, install the agency app again.',
      );
    }
    return tokens.accessToken;
  } catch (error) {
    console.error('[ghl-agency] agency token refresh failed', error);
    await store.releaseClaim(config.clientId, claimId).catch(() => undefined);
    return null;
  }
}

/**
 * The agency token for this request, or null when there is no usable install.
 *
 * Cached for at most an hour per process, for the same reason the sub-account
 * tokens are: a credential can die before its stated expiry and nothing tells
 * us, so a cap bounds the damage to an hour instead of a day.
 */
let cached: { token: string; goodUntil: number } | null = null;
const MAX_CACHE_MS = 60 * 60_000;

export function resetAgencyToken(): void {
  cached = null;
}

export async function currentAgencyToken(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (!agencyEnabled(env)) return null;

  const now = Date.now();
  if (cached !== null && cached.goodUntil > now) return cached.token;

  const config = readAgencyConfig(env);
  if (!config.configured) return null;

  const hub = getHubGhlAgency();
  if (!hub.available) return null;

  const token = await agencyAccessToken({ config: config.config, store: hub.store });
  if (token === null) return null;

  cached = { token, goodUntil: now + MAX_CACHE_MS };
  return token;
}
