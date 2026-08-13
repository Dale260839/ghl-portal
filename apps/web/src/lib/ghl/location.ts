import type { GhlConfig } from './config.ts';

/**
 * Per-request GHL location context (D-013).
 *
 * The Hub is one deployment serving many sub-accounts, so the location a request
 * belongs to comes from the session — never from the environment and never from
 * module state. `GHL_LOCATION_ID` survives only as a development default for
 * working against the build sub-account.
 *
 * The credential is resolved *per location* too. Today that's the single
 * development token; when the Marketplace app lands (D-013 option B) a different
 * resolver returns that location's OAuth token, and nothing above this file
 * changes.
 */

export interface LocationContext {
  locationId: string;
  token: string;
}

export class LocationScopeError extends Error {
  constructor(detail: string) {
    super(`no GHL location in scope — ${detail}`);
    this.name = 'LocationScopeError';
  }
}

/**
 * Resolves the credential for a location.
 *
 * An interface rather than a function so the OAuth implementation can hold state
 * (refresh tokens, expiry) without the call sites learning about it.
 */
export interface TokenResolver {
  readonly kind: 'development' | 'oauth';
  /** Returns null when this resolver has no credential for that location. */
  resolve(locationId: string): Promise<string | null>;
}

/**
 * Development resolver: one token, one location.
 *
 * Deliberately refuses any location other than the one it was configured for.
 * A resolver that returned the build sub-account's token for *any* locationId
 * would appear to work in development and silently cross tenants the first time
 * a second sub-account existed — the exact failure D-013 exists to prevent.
 */
export class DevelopmentTokenResolver implements TokenResolver {
  readonly kind = 'development' as const;
  private readonly locationId: string;
  private readonly token: string;

  constructor(locationId: string, token: string) {
    this.locationId = locationId;
    this.token = token;
  }

  async resolve(locationId: string): Promise<string | null> {
    return locationId === this.locationId ? this.token : null;
  }
}

/**
 * Builds the context for a request. Throws rather than falling back, because
 * the fallback for an unresolved location is another tenant's data.
 */
export async function resolveLocation(
  locationId: string | undefined | null,
  resolver: TokenResolver,
): Promise<LocationContext> {
  if (typeof locationId !== 'string' || locationId.trim() === '') {
    throw new LocationScopeError('the session carries no locationId');
  }

  const token = await resolver.resolve(locationId);
  if (token === null) {
    throw new LocationScopeError(
      `no credential for location ${locationId} (resolver: ${resolver.kind})`,
    );
  }

  return { locationId, token };
}

/** The dev-default resolver, from config. Returns null when unconfigured. */
export function developmentResolver(
  config: GhlConfig,
  defaultLocationId: string | undefined,
): TokenResolver | null {
  if (defaultLocationId === undefined || defaultLocationId.trim() === '') return null;
  return new DevelopmentTokenResolver(defaultLocationId, config.token);
}
