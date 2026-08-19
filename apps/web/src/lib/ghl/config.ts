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
export function canReadProjectObject(config: GhlConfig): boolean {
  return config.projectObjectKey !== '' && config.locationId !== '';
}
