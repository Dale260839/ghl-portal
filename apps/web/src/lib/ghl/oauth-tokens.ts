import 'server-only';

import { randomUUID } from 'node:crypto';

import type { GhlOauthConfig } from './oauth-config.ts';
import type { HubGhlOauth, LocationInstall } from '../hub-db/ghl-oauth.ts';

/**
 * The token half of the Marketplace install: turning the install code into a
 * sub-account's tokens, and keeping the access token alive afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HAZARD IN THIS FILE
 *
 * GoHighLevel rotates the refresh token: every refresh returns a new one and
 * kills the old. On a platform that runs many instances at once (Vercel does),
 * two simultaneous refreshes of the same row mean one instance ends up holding
 * a token that is already dead — and that is the contractor's whole API access.
 *
 * So a refresh is claimed in the database first, and only the winner calls
 * GoHighLevel. The losers wait and re-read the row, which by then holds the
 * winner's token. The claim expires (unlike the invoice claim in 0014) because
 * a crashed refresh must not lock a contractor out for ever; a duplicate
 * refresh wastes a token, where a duplicate invoice would cost a homeowner
 * real money.
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
  /** The sub-account this install is for. GoHighLevel names it in the response. */
  locationId: string;
  companyId: string;
  userType: string;
  scopes: string;
}

interface RawToken {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  locationId?: unknown;
  companyId?: unknown;
  userType?: unknown;
  scope?: unknown;
}

function parseToken(raw: RawToken, now: number): TokenResponse | null {
  const accessToken = typeof raw.access_token === 'string' ? raw.access_token : '';
  const refreshToken = typeof raw.refresh_token === 'string' ? raw.refresh_token : '';
  if (accessToken === '' || refreshToken === '') return null;

  // GHL sends seconds. A missing or nonsensical value is treated as one hour,
  // which is short enough to be safe and long enough not to hammer the endpoint.
  const seconds =
    typeof raw.expires_in === 'number' && Number.isFinite(raw.expires_in) ? raw.expires_in : 3600;

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(now + seconds * 1000).toISOString(),
    locationId: typeof raw.locationId === 'string' ? raw.locationId : '',
    companyId: typeof raw.companyId === 'string' ? raw.companyId : '',
    userType: typeof raw.userType === 'string' ? raw.userType : '',
    scopes: typeof raw.scope === 'string' ? raw.scope : '',
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
    console.error(`[ghl-oauth] token endpoint refused: ${response.status} ${detail.slice(0, 200)}`);
    return null;
  }

  const parsed = parseToken((await response.json()) as RawToken, now);
  if (parsed === null) console.error('[ghl-oauth] token response carried no usable tokens');
  return parsed;
}

/**
 * The install handshake: the one-time code becomes that sub-account's tokens.
 *
 * `user_type: 'Location'` because the scopes we need — contacts, conversations,
 * invoices — are issued only to location-level tokens. GoHighLevel greys them
 * out entirely on an agency-targeted app: *"This scope works with Location-level
 * tokens only, which are issued when a Sub-Account installs your app"*
 * (confirmed in the scope picker, 2026-09-23). An agency install would have
 * been zero-click; it is not available to us.
 */
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
      user_type: 'Location',
      redirect_uri: config.redirectUri,
    },
    options.fetchImpl ?? fetch,
    options.now ?? Date.now(),
  );
}

export interface LocationTokenDeps {
  config: GhlOauthConfig;
  store: HubGhlOauth;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function fresh(install: LocationInstall, now: number): string | null {
  if (install.accessToken === null || install.accessExpiresAt === null) return null;
  const expires = Date.parse(install.accessExpiresAt);
  if (Number.isNaN(expires)) return null;
  return expires - EXPIRY_SKEW_MS > now ? install.accessToken : null;
}

/**
 * A usable access token for one sub-account, or null if it has no working
 * install.
 *
 * Reads the row every time rather than trusting a process-local cache: the row
 * is the only place that knows whether another instance has rotated the token,
 * and one small database read is cheaper than an outage. (The caller keeps a
 * short-lived cache of its own — see `oauth-location.ts`.)
 */
export async function locationAccessToken(
  deps: LocationTokenDeps,
  locationId: string,
): Promise<string | null> {
  const { config, store } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const install = await store.read(config.clientId, locationId);
  if (install === null) return null;

  const existing = fresh(install, now());
  if (existing !== null) return existing;

  const claimId = randomUUID();
  if (!(await store.claim(config.clientId, locationId, claimId, CLAIM_STALE_MS))) {
    // Another instance is refreshing this very row. Wait for it rather than
    // starting a second refresh that would invalidate whichever token loses.
    await sleep(LOSER_WAIT_MS);
    const after = await store.read(config.clientId, locationId);
    return after === null ? null : fresh(after, now());
  }

  try {
    const tokens = await postToken(
      config,
      {
        grant_type: 'refresh_token',
        refresh_token: install.refreshToken,
        user_type: 'Location',
      },
      fetchImpl,
      now(),
    );

    if (tokens === null) {
      await store.releaseClaim(config.clientId, locationId, claimId);
      return null;
    }

    // If GoHighLevel names a location in the response it must be the one we
    // refreshed. Storing another sub-account's token against this row would be
    // a cross-tenant leak with a very long life.
    if (tokens.locationId !== '' && tokens.locationId !== locationId) {
      console.error(
        `[ghl-oauth] refreshed ${locationId} and was given ${tokens.locationId} — refusing`,
      );
      await store.releaseClaim(config.clientId, locationId, claimId);
      return null;
    }

    const saved = await store.saveRefreshed(config.clientId, locationId, claimId, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      accessExpiresAt: tokens.expiresAt,
    });

    if (!saved) {
      // Our claim expired and another instance took over mid-refresh. The token
      // in hand still works for this request, but the refresh token we were
      // given is now the only live one and we could not store it. Loud, because
      // the fix is a re-install of that sub-account and nothing else will say so.
      console.error(
        `[ghl-oauth] refreshed ${locationId} but could not store it — the claim was taken. ` +
          'If that sub-account starts failing, install the app on it again.',
      );
    }
    return tokens.accessToken;
  } catch (error) {
    console.error(`[ghl-oauth] token refresh failed for ${locationId}`, error);
    await store.releaseClaim(config.clientId, locationId, claimId).catch(() => undefined);
    return null;
  }
}
