/**
 * The agency Marketplace app's own credentials, read from the environment.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 *
 * `GHL_LOCATION_TOKENS` — a `locationId:token` map that somebody has to extend
 * by hand for every new contractor, because a Private Integration token only
 * opens the sub-account it was made in. This is the agency-level alternative:
 * one app, installed once, able to mint a short-lived token for any sub-account
 * it is installed on.
 *
 * WHAT IS AND IS NOT A SECRET HERE
 *
 * `GHL_OAUTH_CLIENT_SECRET` is the one that matters and it never leaves the
 * server: no `NEXT_PUBLIC_` prefix, and the guardrail test that checks every
 * secret-shaped variable covers it. The client id and the redirect URI are
 * public by design — they appear in the authorisation URL a browser follows.
 *
 * THE FLAG IS THE REVERT
 *
 * `GHL_OAUTH_ENABLED` is not a feature toggle for convenience. With it unset,
 * every call site resolves credentials through exactly the code that ran
 * yesterday (`withLocationToken`), and none of this file's machinery is
 * reached. Turning it off is the fastest rollback available and needs no
 * deploy — see `docs/ROLLBACK-GHL-OAUTH.md`.
 * ---------------------------------------------------------------------------
 */

export interface GhlOauthConfig {
  clientId: string;
  clientSecret: string;
  /** Where GoHighLevel returns the browser after the agency approves. */
  redirectUri: string;
  /** Token exchange and location-token minting. Same host as the data API. */
  apiBase: string;
  /** Where the agency is sent to approve the install. */
  authorizeBase: string;
  /**
   * The Marketplace app id, needed only by `GET /oauth/installedLocations`.
   * Optional: without it we simply do not cache an install list, and a
   * location either mints a token or does not.
   */
  appId: string;
  /**
   * The agency's company id. Optional because the token response carries it —
   * this is only a check that we installed into the agency we meant to.
   */
  companyId: string;
}

export type GhlOauthResult =
  | { configured: true; config: GhlOauthConfig }
  | { configured: false; missing: string[] };

const DEFAULT_API_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_AUTHORIZE_BASE = 'https://marketplace.gohighlevel.com';

const REQUIRED = [
  'GHL_OAUTH_CLIENT_ID',
  'GHL_OAUTH_CLIENT_SECRET',
  'GHL_OAUTH_REDIRECT_URI',
] as const;

export function readOauthConfig(env: NodeJS.ProcessEnv = process.env): GhlOauthResult {
  const missing = REQUIRED.filter((key) => {
    const value = env[key];
    return value === undefined || value.trim() === '';
  });
  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    config: {
      clientId: env.GHL_OAUTH_CLIENT_ID!.trim(),
      clientSecret: env.GHL_OAUTH_CLIENT_SECRET!.trim(),
      redirectUri: env.GHL_OAUTH_REDIRECT_URI!.trim().replace(/\/+$/, ''),
      apiBase: (env.GHL_API_BASE_URL ?? DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
      authorizeBase: (env.GHL_OAUTH_AUTHORIZE_BASE ?? DEFAULT_AUTHORIZE_BASE)
        .trim()
        .replace(/\/+$/, ''),
      appId: (env.GHL_OAUTH_APP_ID ?? '').trim(),
      companyId: (env.GHL_AGENCY_COMPANY_ID ?? '').trim(),
    },
  };
}

/**
 * Whether resolved credentials should come from the Marketplace install.
 *
 * Deliberately two conditions, not one: the flag AND a complete configuration.
 * A flag set against a half-configured app would take every contractor's API
 * access down to prove a typo, so an incomplete config is treated as "off"
 * rather than as an error.
 */
export function oauthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.GHL_OAUTH_ENABLED ?? '').trim().toLowerCase() !== 'true') return false;
  return readOauthConfig(env).configured;
}

/**
 * The scopes the app asks for: exactly what the Hub already calls, and nothing
 * else. An unused scope on an agency-wide install is permission granted for no
 * reason.
 *
 * Kept here rather than in the app's Marketplace settings so the list is
 * reviewable in the repository — GoHighLevel's own scope picker is the
 * authority on the exact strings, and these are confirmed against it at install
 * time (§5 of docs/PLAN-GHL-AGENCY-OAUTH.md).
 */
export const OAUTH_SCOPES = [
  'locations.readonly',
  'contacts.readonly',
  'contacts.write',
  'conversations.readonly',
  'conversations.write',
  'conversations/message.readonly',
  'conversations/message.write',
  'objects/schema.readonly',
  'objects/record.readonly',
  'objects/record.write',
  'invoices.readonly',
  'invoices.write',
  'invoices/template.readonly',
  'invoices/template.write',
] as const;

/** Where to send the agency owner to approve the install. */
export function authorizeUrl(config: GhlOauthConfig, state: string): string {
  const url = new URL(`${config.authorizeBase}/oauth/chooselocation`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', OAUTH_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}
