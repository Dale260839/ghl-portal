/**
 * The agency Marketplace app's own credentials, read from the environment.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS REPLACES
 *
 * `GHL_LOCATION_TOKENS` — a `locationId:token` map that somebody has to extend
 * by hand for every new contractor, because a Private Integration token only
 * opens the sub-account it was made in. Installing this app on a sub-account
 * hands us that sub-account's tokens instead: one click, no credential ever
 * touched by a person, and it refreshes itself from then on.
 *
 * It was designed as a single agency-level install, which would have been
 * zero-click. GoHighLevel does not allow it — the scopes the Hub needs are
 * issued to location-level tokens only, and are greyed out on an
 * agency-targeted app (scope picker, 2026-09-23).
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
 * else. Each one is traced to the endpoint that needs it, below.
 *
 * Deliberately absent: anything under Objects. The custom-object data source
 * has never been switched on (`GHL_PROJECT_OBJECT_KEY` is unset) and needs a
 * tenancy fix before it is — see the note in the plan. A scope we do not use
 * is permission held for no reason, and every one of these is granted by a
 * contractor over their own CRM.
 *
 * Kept here rather than only in the app's Marketplace settings so the list is
 * reviewable in the repository. GoHighLevel's scope picker is the authority on
 * the exact strings.
 */
export const OAUTH_SCOPES = [
  // GET /locations/{id} — proving a sub-account at sign-in.
  'locations.readonly',
  // POST /contacts/search, POST /contacts/ — finding or creating the person an
  // email is addressed to.
  'contacts.readonly',
  'contacts.write',
  // POST /conversations/messages — sending it.
  'conversations.write',
  'conversations/message.write',
  // GET /invoices/ and POST /invoices/ — the Payments screen and the rail.
  'invoices.readonly',
  'invoices.write',
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

/**
 * Whether to send an unconnected contractor straight at the approval screen.
 *
 * ---------------------------------------------------------------------------
 * OFF BY DEFAULT, AND THE REASON MATTERS
 *
 * The approval screen lives on `marketplace.gohighlevel.com`. A contractor in a
 * white-labelled agency signs in at the agency's own domain and has never seen
 * that one — so an automatic redirect hands them "Please login to HighLevel to
 * continue" and a login they do not have. That is a worse dead end than the one
 * it was meant to remove, because at least the old one was honest.
 *
 * The route that works for them is the App Marketplace **inside their own
 * account**, which uses the session they already have. That is what the connect
 * page tells them to do.
 *
 * So this exists for the case where it genuinely helps — an agency admin
 * installing on a contractor's behalf, who does have that login — and stays off
 * everywhere else.
 * ---------------------------------------------------------------------------
 */
export function autoConnectEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.GHL_AUTO_CONNECT ?? '').trim().toLowerCase() === 'true';
}

// ── The agency app, which is a different app ────────────────────────────────

/**
 * The agency-level Marketplace app: one install, used for one thing.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE TWO APPS
 *
 * GoHighLevel will not sell one credential that does both jobs.
 *
 *   · Signing a contractor in makes exactly one call, `GET /locations/{id}`.
 *     `locations.readonly` is available to an agency app — it is badged
 *     "Sub + agency" in the scope picker.
 *   · Invoices and emails need contacts, conversations and invoices, which are
 *     greyed out on an agency app: *"This scope works with Location-level
 *     tokens only, which are issued when a Sub-Account installs your app."*
 *
 * So the agency app proves sub-accounts, and the sub-account app does the work.
 * The effect is that a contractor who has installed nothing can still sign in
 * and see everything that comes from BuildSuite — which is almost all of it —
 * and is only asked to approve when they first send an invoice or an email.
 *
 * Absent configuration means absent, not broken: sign-in falls back to the
 * sub-account token or the Private Integration token, exactly as before.
 * ---------------------------------------------------------------------------
 */
const AGENCY_REQUIRED = [
  'GHL_AGENCY_CLIENT_ID',
  'GHL_AGENCY_CLIENT_SECRET',
  'GHL_AGENCY_REDIRECT_URI',
] as const;

export function readAgencyConfig(env: NodeJS.ProcessEnv = process.env): GhlOauthResult {
  const missing = AGENCY_REQUIRED.filter((key) => {
    const value = env[key];
    return value === undefined || value.trim() === '';
  });
  if (missing.length > 0) return { configured: false, missing };

  return {
    configured: true,
    config: {
      clientId: env.GHL_AGENCY_CLIENT_ID!.trim(),
      clientSecret: env.GHL_AGENCY_CLIENT_SECRET!.trim(),
      redirectUri: env.GHL_AGENCY_REDIRECT_URI!.trim().replace(/\/+$/, ''),
      apiBase: (env.GHL_API_BASE_URL ?? DEFAULT_API_BASE).trim().replace(/\/+$/, ''),
      authorizeBase: (env.GHL_OAUTH_AUTHORIZE_BASE ?? DEFAULT_AUTHORIZE_BASE)
        .trim()
        .replace(/\/+$/, ''),
    },
  };
}

/**
 * Whether the agency install may be used.
 *
 * Deliberately NOT gated on `GHL_OAUTH_ENABLED`. That switch governs which
 * credential does the work — invoices, emails — and rolling it back must not
 * also take away the thing that lets people sign in. They are separate
 * decisions and separate failure modes.
 */
export function agencyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.GHL_AGENCY_ENABLED ?? '').trim().toLowerCase() !== 'true') return false;
  return readAgencyConfig(env).configured;
}

/**
 * One scope, and it stays one scope.
 *
 * This credential can reach every sub-account in the agency. Anything added
 * here is granted across all of them at once, so the bar is not "might be
 * useful" — it is "sign-in cannot work without it".
 */
export const AGENCY_SCOPES = ['locations.readonly'] as const;

export function agencyAuthorizeUrl(config: GhlOauthConfig, state: string): string {
  const url = new URL(`${config.authorizeBase}/oauth/chooselocation`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', AGENCY_SCOPES.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}
