/**
 * GHL connection config, read from the environment.
 *
 * Returns null when unconfigured rather than throwing, so the app runs on
 * fixtures with no credentials at all — that is the whole reason the demo
 * exists before the keys do.
 */

export interface GhlConfig {
  baseUrl: string;
  apiVersion: string;
  locationId: string;
  token: string;
  /** The Project custom object's key as GHL addresses it. From Phase 0. */
  projectObjectKey: string;
}

export type ConfigResult =
  | { configured: true; config: GhlConfig }
  | { configured: false; missing: string[] };

const REQUIRED = [
  'GHL_API_BASE_URL',
  'GHL_API_VERSION',
  'GHL_LOCATION_ID',
  'GHL_PRIVATE_INTEGRATION_TOKEN',
  'GHL_PROJECT_OBJECT_KEY',
] as const;

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
      locationId: env.GHL_LOCATION_ID!,
      token: env.GHL_PRIVATE_INTEGRATION_TOKEN!,
      projectObjectKey: env.GHL_PROJECT_OBJECT_KEY!,
    },
  };
}
