/**
 * GHL connection config, read from the environment.
 *
 * Returns null-ish rather than throwing when unconfigured, so the app runs on
 * fixtures with no credentials at all — that is the whole reason the demo
 * exists before the keys do.
 *
 * **Only three variables are genuinely required.** Auto-login needs to call
 * `/locations/{id}`, which wants a base URL, a version and a token — nothing
 * else. Demanding the custom-object key here would block sign-in on a value
 * sign-in never uses, which is how a working credential ends up looking broken.
 */

export interface GhlConfig {
  baseUrl: string;
  apiVersion: string;
  token: string;
  /** Per-request (D-013). The dev default fills it in for local work. */
  locationId: string;
  /**
   * Needed only to address the Project custom object. Empty until Phase 0
   * reports it, which is why it is not part of `configured`.
   */
  projectObjectKey: string;
}

export type ConfigResult =
  | { configured: true; config: GhlConfig }
  | { configured: false; missing: string[] };

/** The minimum to talk to GHL at all. */
const REQUIRED = ['GHL_API_BASE_URL', 'GHL_API_VERSION', 'GHL_PRIVATE_INTEGRATION_TOKEN'] as const;

export function readGhlConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const missing = REQUIRED.filter((key) => {
    const value = env[key];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    return { configured: false, missing };
  }

  return {
    configured: true,
    config: {
      baseUrl: env.GHL_API_BASE_URL!.replace(/\/+$/, ''),
      apiVersion: env.GHL_API_VERSION!,
      token: env.GHL_PRIVATE_INTEGRATION_TOKEN!,
      // `GHL_DEV_LOCATION_ID` is the documented name; `GHL_LOCATION_ID` is
      // accepted because it is what people reach for and a silent mismatch here
      // costs an afternoon.
      locationId: (env.GHL_DEV_LOCATION_ID ?? env.GHL_LOCATION_ID ?? '').trim(),
      projectObjectKey: (env.GHL_PROJECT_OBJECT_KEY ?? '').trim(),
    },
  };
}

/**
 * Whether custom-object reads are possible. Separate from `configured` because
 * the answer is "not yet" long after GHL itself is reachable.
 */
/**
 * A GoHighLevel sub-account id: the alphanumeric ids GHL mints, never a fixture
 * label like `loc_alliance_pro` or the Hub's own `buildsuite:location-unknown`
 * placeholder. Only a real one may be sent to the API.
 */
export function isGhlLocationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9]{15,40}$/.test(value.trim());
}

/**
 * The location the API calls should address.
 *
 * The env var names one sub-account for the whole deployment, which is right
 * for a dev box and wrong for a product with more than one contractor. The
 * signed-in contractor already carries their sub-account (their BuildSuite
 * profile's `location_id`, or the GHL menu link they arrived through), so that
 * is preferred; the env var is the fallback for sessions that carry none.
 * Chris's pilot on 11 Sep stalled on the env var being unset while the session
 * knew the location all along.
 */
export function withLocation(config: GhlConfig, sessionLocationId?: string | null): GhlConfig {
  if (isGhlLocationId(sessionLocationId)) return { ...config, locationId: sessionLocationId.trim() };
  return config;
}

/**
 * Per-sub-account Private Integration tokens, from `GHL_LOCATION_TOKENS`.
 *
 * A PIT only opens its own sub-account. Measured 17 Sep: the Alliance For
 * Contractors token gets `401 This location is not accessible from this token!`
 * on Alliance Pro Services, and the APS token gets the same on AFC. So
 * `withLocation` swapping the location while keeping the one env token sends
 * every other contractor's invoice call to a guaranteed 401.
 *
 * Format: `locationId:token`, comma- or newline-separated. Entries whose key is
 * not a real GHL id are ignored rather than guessed at.
 */
export function readLocationTokens(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const entry of (env.GHL_LOCATION_TOKENS ?? '').split(/[,\n]/)) {
    const i = entry.indexOf(':');
    if (i === -1) continue;
    const locationId = entry.slice(0, i).trim();
    const token = entry.slice(i + 1).trim();
    if (isGhlLocationId(locationId) && token !== '') tokens.set(locationId, token);
  }
  return tokens;
}

/**
 * `withLocation`, plus that location's own token when one is configured.
 *
 * Without an entry the default `GHL_PRIVATE_INTEGRATION_TOKEN` stands, exactly
 * as before — so the sub-account that token belongs to is untouched.
 */
export function withLocationToken(
  config: GhlConfig,
  sessionLocationId?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): GhlConfig {
  const located = withLocation(config, sessionLocationId);
  const token = readLocationTokens(env).get(located.locationId);
  return token === undefined ? located : { ...located, token };
}

export function canReadProjectObject(config: GhlConfig): boolean {
  return config.projectObjectKey !== '' && config.locationId !== '';
}
