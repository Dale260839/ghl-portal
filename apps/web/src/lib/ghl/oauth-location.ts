import 'server-only';

import type { TokenResolver } from './location.ts';
import type { GhlOauthConfig } from './oauth-config.ts';
import { locationAccessToken } from './oauth-tokens.ts';
import { isGhlLocationId } from './config.ts';
import type { HubGhlOauth } from '../hub-db/ghl-oauth.ts';

/**
 * A sub-account's credential, from its Marketplace install.
 *
 * This is the file that replaces `GHL_LOCATION_TOKENS`. Where that map needed a
 * person to create a Private Integration token per contractor and paste it into
 * the environment, this reads the tokens that sub-account handed us when the
 * app was installed on it, and keeps them alive.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE MUST NEVER BREAK
 *
 * It returns a credential for the location it was asked about, or null. Never
 * another location's, and never the default Private Integration token —
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
  /** Epoch ms. */
  goodUntil: number;
}

/**
 * How long a token is trusted from cache, whatever life GoHighLevel gave it.
 *
 * A token can die before its stated expiry — the app uninstalled from that
 * sub-account, the install replaced — and nothing tells us. Without a cap a
 * process would keep presenting a dead token and every call would 401. An hour
 * bounds that to an hour, at a cost of one small database read per sub-account
 * per hour, which is nothing.
 */
const MAX_CACHE_MS = 60 * 60_000;
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

    let token: string | null = null;
    try {
      token = await locationAccessToken(
        {
          config: this.deps.config,
          store: this.deps.store,
          ...(this.deps.fetchImpl !== undefined ? { fetchImpl: this.deps.fetchImpl } : {}),
          ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
        },
        id,
      );
    } catch (error) {
      console.warn(`[ghl-oauth] resolving a token for ${id} failed`, error);
    }

    if (token === null) {
      refusals.set(id, now);
      return null;
    }

    refusals.delete(id);
    tokens.set(id, { token, goodUntil: now + MAX_CACHE_MS });
    return token;
  }

  /**
   * Throw away a location's cached token — for the case where a token was
   * accepted by the cache but rejected by GoHighLevel.
   */
  forget(locationId: string): void {
    tokens.delete(locationId.trim());
  }
}
