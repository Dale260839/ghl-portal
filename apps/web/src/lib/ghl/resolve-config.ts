import 'server-only';

import { withLocationToken, type GhlConfig } from './config.ts';
import { oauthEnabled, readOauthConfig } from './oauth-config.ts';
import { OauthTokenResolver } from './oauth-location.ts';
import { getHubGhlOauth } from '../hub-db/ghl-oauth.ts';

/**
 * Which credential a request uses, decided in one place.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE OF THIS FUNCTION IS THE ROLLBACK PLAN
 *
 * Today's answer — `withLocationToken`, the per-sub-account Private Integration
 * token from `GHL_LOCATION_TOKENS` — is computed FIRST and returned unless the
 * Marketplace install produces something better. So:
 *
 *   · `GHL_OAUTH_ENABLED` unset  → this function is `withLocationToken` with an
 *     `await` in front of it. Byte for byte the behaviour of 2026-09-22.
 *   · flag on, install healthy   → the location's own minted token.
 *   · flag on, anything at all   → the PIT, and a warning naming the location.
 *     wrong with the install
 *
 * That middle failure mode is the point. While both credentials exist, a broken
 * OAuth install is a line in the log rather than every contractor's invoices
 * failing at once. The PITs are deleted only after the install is proven on
 * real work — a separate, deliberate change (docs/ROLLBACK-GHL-OAUTH.md).
 * ---------------------------------------------------------------------------
 */

let resolver: OauthTokenResolver | null = null;
const warned = new Set<string>();

/** Test seam, and the install callback's way of picking up a new install. */
export function resetResolvedConfig(): void {
  resolver = null;
  warned.clear();
}

function oauthResolver(env: NodeJS.ProcessEnv): OauthTokenResolver | null {
  if (resolver !== null) return resolver;

  const oauth = readOauthConfig(env);
  if (!oauth.configured) return null;

  const hub = getHubGhlOauth();
  if (!hub.available) {
    console.warn(
      `[ghl-oauth] the Hub database is unavailable (${hub.missing.join(', ')}) — ` +
        'the Marketplace install cannot be read, using Private Integration tokens',
    );
    return null;
  }

  resolver = new OauthTokenResolver({ config: oauth.config, store: hub.store });
  return resolver;
}

/**
 * `withLocationToken`, plus the Marketplace install when it is switched on and
 * working.
 *
 * Async because minting a location token is a network call. That is the whole
 * reason the four call sites gained an `await`; nothing else about them moved.
 */
export async function configForLocation(
  config: GhlConfig,
  sessionLocationId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GhlConfig> {
  const located = withLocationToken(config, sessionLocationId, env);
  if (!oauthEnabled(env)) return located;
  if (located.locationId.trim() === '') return located;

  const oauth = oauthResolver(env);
  if (oauth === null) return located;

  const token = await oauth.resolve(located.locationId);
  if (token === null) {
    // Once per location per process. This line is what turns "invoices are
    // failing for one contractor" into "the app is not installed on their
    // sub-account", which is the difference between an hour and a minute.
    if (!warned.has(located.locationId)) {
      warned.add(located.locationId);
      console.warn(
        `[ghl-oauth] no Marketplace token for ${located.locationId} — falling back to the ` +
          'Private Integration token. Check the app is installed on that sub-account.',
      );
    }
    return located;
  }

  return { ...located, token };
}

/**
 * Tell the resolver a token was rejected, so the next request mints a new one.
 *
 * A cached location token can outlive the install being removed, or the agency
 * token being rotated elsewhere. Without this, the process would keep
 * presenting the same dead token for up to its full lifetime.
 */
export function forgetLocationToken(locationId: string): void {
  resolver?.forget(locationId);
}
