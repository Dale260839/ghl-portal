import 'server-only';

import type { TokenResolver } from './location.ts';
import type { GhlOauthConfig } from './oauth-config.ts';
import { agencyAccessToken } from './oauth-agency.ts';
import { isGhlLocationId } from './config.ts';
import type { HubGhlOauth } from '../hub-db/ghl-oauth.ts';

/**
 * A sub-account's own short-lived token, minted from the agency install.
 *
 * This is the file that replaces `GHL_LOCATION_TOKENS`. Where that map needed a
 * human to create a Private Integration token per contractor and paste it into
 * the environment, this asks GoHighLevel for one, per location, on demand.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE MUST NEVER BREAK
 *
 * It returns a token for the location it was asked about, or null. Never
 * another location's token, and never the default Private Integration token —
 * because the fallback for an unresolved location is another tenant's data,
 * which is the entire reason D-013 put a resolver here in the first place.
 *
 * Whether to fall back to a PIT is a decision made one level up, in
 * `resolve-config.ts`, where it is visible. Burying it here would make a
 * cross-tenant leak look like a cache miss.
 * ---------------------------------------------------------------------------
 */

interface CachedToken {
  token: string;
  /** Epoch ms, already reduced by the safety margin. */
  goodUntil: number;
}

/** Location tokens live ~24h. Re-minting costs one call, so expire early. */
const EXPIRY_SKEW_MS = 10 * 60_000;
/**
 * How long a refusal is remembered. Short on purpose: the usual cause is an
 * install that has not happened yet, and nobody should have to wait out a long
 * cache after clicking Install.
 */
const NEGATIVE_TTL_MS = 60_000;

const tokens = new Map<string, CachedToken>();
const refusals = new Map<string, number>();

/** For tests, and for the install callback — a fresh install invalidates both. */
export function resetLocationTokens(): void {
  tokens.clear();
  refusals.clear();
}

interface RawLocationToken {
  access_token?: unknown;
  expires_in?: unknown;
  locationId?: unknown;
}

/**
 * POST /oauth/locationToken. Form-encoded like the token endpoint, and it
 * wants the AGENCY token in the header and the location in the body.
 */
async function mint(
  config: GhlOauthConfig,
  agencyToken: string,
  companyId: string,
  locationId: string,
  fetchImpl: typeof fetch,
  now: number,
): Promise<CachedToken | null> {
  const response = await fetchImpl(`${config.apiBase}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agencyToken}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ companyId, locationId }).toString(),
  });

  if (!response.ok) {
    // 401 here means the app is not installed on that sub-account — the normal,
    // expected answer for a location we do not serve. Warn rather than error.
    console.warn(
      `[ghl-oauth] no location token for ${locationId}: ${response.status}`,
    );
    return null;
  }

  const body = (await response.json()) as RawLocationToken;
  const token = typeof body.access_token === 'string' ? body.access_token : '';
  if (token === '') return null;

  // If GoHighLevel names a location in the response, it must be the one we
  // asked for. A mismatch is a bug worth failing on, not worth papering over:
  // handing back a token for another sub-account is precisely the leak this
  // resolver exists to prevent.
  if (typeof body.locationId === 'string' && body.locationId !== locationId) {
    console.error(
      `[ghl-oauth] asked for ${locationId} and was given ${body.locationId} — refusing`,
    );
    return null;
  }

  const seconds =
    typeof body.expires_in === 'number' && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 86_400;
  return { token, goodUntil: now + Math.max(0, seconds * 1000 - EXPIRY_SKEW_MS) };
}

export interface OauthResolverDeps {
  config: GhlOauthConfig;
  store: HubGhlOauth;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * The `TokenResolver` that `lib/ghl/location.ts` was written for in August:
 * *"when the Marketplace app lands (D-013 option B) a different resolver
 * returns that location's OAuth token, and nothing above this file changes."*
 */
export class OauthTokenResolver implements TokenResolver {
  readonly kind = 'oauth' as const;
  private readonly deps: OauthResolverDeps;

  constructor(deps: OauthResolverDeps) {
    this.deps = deps;
  }

  async resolve(locationId: string): Promise<string | null> {
    const id = locationId.trim();
    // A fixture label like `loc_alliance_pro` must never reach the API.
    if (!isGhlLocationId(id)) return null;

    const now = (this.deps.now ?? Date.now)();

    const cached = tokens.get(id);
    if (cached !== undefined && cached.goodUntil > now) return cached.token;

    const refusedAt = refusals.get(id);
    if (refusedAt !== undefined && now - refusedAt < NEGATIVE_TTL_MS) return null;

    const install = await this.deps.store.read(this.deps.config.clientId);
    if (install === null) return null;

    const agencyToken = await agencyAccessToken({
      config: this.deps.config,
      store: this.deps.store,
      ...(this.deps.fetchImpl !== undefined ? { fetchImpl: this.deps.fetchImpl } : {}),
      ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
    });
    if (agencyToken === null) return null;

    const companyId = install.companyId || this.deps.config.companyId;
    if (companyId === '') {
      console.error('[ghl-oauth] the install carries no companyId — cannot mint location tokens');
      return null;
    }

    let minted: CachedToken | null = null;
    try {
      minted = await mint(
        this.deps.config,
        agencyToken,
        companyId,
        id,
        this.deps.fetchImpl ?? fetch,
        now,
      );
    } catch (error) {
      console.warn(`[ghl-oauth] minting a token for ${id} failed`, error);
    }

    if (minted === null) {
      refusals.set(id, now);
      return null;
    }

    refusals.delete(id);
    tokens.set(id, minted);
    return minted.token;
  }

  /**
   * Throw away a location's cached token — for the 401-and-retry path, where
   * the token was accepted by the cache but rejected by GoHighLevel.
   */
  forget(locationId: string): void {
    tokens.delete(locationId.trim());
  }
}
