import 'server-only';

import { randomUUID } from 'node:crypto';

import type { GhlOauthConfig } from './oauth-config.ts';
import type { HubGhlOauth, OauthInstall } from '../hub-db/ghl-oauth.ts';

/**
 * The agency-level half of the Marketplace install: the refresh token, and the
 * short-lived agency access token minted from it.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HAZARD IN THIS FILE
 *
 * GoHighLevel rotates the refresh token: every refresh returns a new one and
 * kills the old. On a platform that runs many instances at once (Vercel does),
 * two simultaneous refreshes mean one instance ends up holding a token that is
 * already dead — and since this single credential is what every contractor's
 * API access now depends on, that is an outage for all of them rather than one.
 *
 * So a refresh is claimed in the database first, and only the winner calls
 * GoHighLevel. The losers wait and re-read the row, which by then holds the
 * winner's token. The claim expires (unlike the invoice claim in 0014) because
 * a crashed refresh must not lock the agency out for ever; a duplicate refresh
 * wastes a token, where a duplicate invoice would cost a homeowner real money.
 *
 * NOTHING HERE THROWS ITS WAY TO A USER. Every failure returns null, and the
 * caller falls back to the Private Integration token that serves that location
 * today. A broken install is a logged degradation, not a blank screen.
 * ---------------------------------------------------------------------------
 */

/** Re-mint this long before expiry, so a request never races the clock. */
const EXPIRY_SKEW_MS = 5 * 60_000;
/** A refresh takes a second or two. A claim older than this is abandoned. */
const CLAIM_STALE_MS = 60_000;
/** How long to wait for the instance that won the claim. */
const LOSER_WAIT_MS = 1_500;

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  companyId: string;
  userType: string;
}

interface RawToken {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  companyId?: unknown;
  userType?: unknown;
}

function parseToken(raw: RawToken, now: number): TokenResponse | null {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : '';
  if (accessToken === '' || refreshToken === '') return null;

  // GHL sends seconds. A missing or nonsensical value is treated as one hour,
  // which is short enough to be safe and long enough not to hammer the endpoint.
  const seconds = typeof raw.expires_in === 'number' && Number.isFinite(raw.expires_in)
    ? raw.expires_in
    : 3600;

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(now + seconds * 1000).toISOString(),
    companyId: typeof raw.companyId === 'string' ? raw.companyId : '',
    userType: typeof raw.userType === 'string' ? raw.userType : '',
  };
}

/**
 * POST /oauth/token — form-encoded, not JSON. GoHighLevel rejects JSON here
 * with a 422 that says nothing useful, which is an afternoon if you guess.
 */
async function postToken(
  config: GhlOauthConfig,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
  now: number,
): Promise<TokenResponse | null> {
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
    console.error(
      `[ghl-oauth] token endpoint refused: ${response.status} ${detail.slice(0, 200)}`,
    );
    return null;
  }

  const parsed = parseToken((await response.json()) as RawToken, now);
  if (parsed === null) console.error('[ghl-oauth] token response carried no usable tokens');
  return parsed;
}

/** The install handshake: the one-time code becomes the agency refresh token. */
export function exchangeCode(
  config: GhlOauthConfig,
  code: string,
  options: { fetchImpl?: typeof fetch; now?: number } = {},
): Promise<TokenResponse | null> {
  return postToken(
    config,
    {
      grant_type: 'authorization_code',
      code,
      // Agency-level, not a single sub-account. This is the whole point of the
      // change: `Location` would install into one sub-account and we would be
      // back to a key per contractor.
      user_type: 'Company',
      redirect_uri: config.redirectUri,
    },
    options.fetchImpl ?? fetch,
    options.now ?? Date.now(),
  );
}

export interface AgencyTokenDeps {
  config: GhlOauthConfig;
  store: HubGhlOauth;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function fresh(install: OauthInstall, now: number): string | null {
  if (install.accessToken === null || install.accessExpiresAt === null) return null;
  const expires = Date.parse(install.accessExpiresAt);
  if (Number.isNaN(expires)) return null;
  return expires - EXPIRY_SKEW_MS > now ? install.accessToken : null;
}

/**
 * A usable agency access token, or null if there is no working install.
 *
 * Reads the row every time rather than trusting a process-local cache: the row
 * is the only place that knows whether another instance has rotated the token,
 * and one small database read is cheaper than an outage.
 */
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
    // Another instance is refreshing this very second. Wait for it rather than
    // starting a second refresh that would invalidate whichever token loses.
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
      // Our claim expired and someone else took over mid-refresh. The token in
      // hand still works for this request, but the refresh token we were given
      // is now the only live one and we could not store it. Loud, because the
      // fix is a re-install and nothing else will say so.
      console.error(
        '[ghl-oauth] refreshed the agency token but could not store it — the claim was taken. ' +
          'If API calls start failing, re-install the Marketplace app.',
      );
    }
    return tokens.accessToken;
  } catch (error) {
    console.error('[ghl-oauth] agency token refresh failed', error);
    await store.releaseClaim(config.clientId, claimId).catch(() => undefined);
    return null;
  }
}

interface InstalledLocationsResponse {
  locations?: { _id?: unknown; id?: unknown }[];
}

/**
 * Which sub-accounts the app is installed on.
 *
 * Used for the install confirmation screen and as a cache. It is never the
 * authority on who may sign in — that stays with BuildSuite's auth profiles,
 * exactly as it is today. A location on this list with no profile still gets no
 * session.
 */
export async function installedLocations(
  config: GhlOauthConfig,
  agencyToken: string,
  companyId: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<string[] | null> {
  if (config.appId === '') return null;
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = new URL(`${config.apiBase}/oauth/installedLocations`);
  url.searchParams.set('companyId', companyId);
  url.searchParams.set('appId', config.appId);
  url.searchParams.set('limit', '500');

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${agencyToken}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.warn(`[ghl-oauth] installedLocations returned ${response.status}`);
      return null;
    }
    const body = (await response.json()) as InstalledLocationsResponse;
    return (body.locations ?? [])
      .map((l) => (typeof l._id === 'string' ? l._id : typeof l.id === 'string' ? l.id : ''))
      .filter((id) => id !== '');
  } catch (error) {
    console.warn('[ghl-oauth] installedLocations failed', error);
    return null;
  }
}
