import { GhlClient } from '../ghl/client.ts';
import type { GhlConfig } from '../ghl/config.ts';

/**
 * Verifying a Custom Menu Link landing against the GHL API.
 *
 * **Why this exists.** A menu link hands us `locationId` as a plain query
 * parameter. GoHighLevel does not sign it, so on its own it is a claim — anyone
 * who learns the callback URL could substitute another agency's location and,
 * because tenancy comes from the session, be handed that agency's projects.
 *
 * So we treat the URL as an assertion and check it: ask GHL, using our own
 * credential, whether that location is real and reachable by us. A location our
 * token can't see isn't ours to sign anyone into.
 *
 * **What it does not prove.** That the person holding the browser came from
 * GoHighLevel at all. A leaked URL still works until the setup changes. GHL's
 * Marketplace SSO — where GHL hands the page signed, encrypted user data — is
 * the fix, and it's the same piece of work as multi-sub-account tokens.
 * BuildSuite's own callback has the same property today.
 */

export type LocationOutcome =
  | { verified: true; name: string }
  | { verified: false; reason: 'unknown_location' | 'bad_credential' | 'lookup_failed' };

/**
 * Three failures that look alike and need different fixes.
 *
 * Measured against the live API, not guessed: a location our token cannot reach
 * returns **403 Forbidden**, not 404. That's the forged-landing case, and it
 * means the link is wrong.
 *
 * A **401** is different — it says our own credential is bad, which is an
 * operator problem, not the visitor's. Reporting it as "bad link" would send
 * someone to check the menu link when they should be checking the token.
 *
 * Anything else — 5xx, a timeout, DNS — is an outage, and the honest message is
 * "try again" rather than implying anyone did something wrong.
 */
function classify(error: unknown): 'unknown_location' | 'bad_credential' | 'lookup_failed' {
  const status = (error as { status?: number | null } | null)?.status;
  if (status === 401) return 'bad_credential';
  if (status === 400 || status === 403 || status === 404) return 'unknown_location';
  return 'lookup_failed';
}

interface GhlLocationResponse {
  id?: string;
  name?: string;
  location?: { id?: string; name?: string };
}

export async function verifyGhlLocation(
  locationId: string,
  config: GhlConfig,
  client?: GhlClient,
): Promise<LocationOutcome> {
  const id = locationId.trim();
  if (id === '') return { verified: false, reason: 'unknown_location' };

  const ghl = client ?? new GhlClient({ config });

  try {
    const response = await ghl.request<GhlLocationResponse>({
      path: `/locations/${id}`,
      describe: `GHL location ${id}`,
    });

    // GHL wraps some responses and not others.
    const location = response.location ?? response;
    if (typeof location.id !== 'string' || location.id === '') {
      return { verified: false, reason: 'unknown_location' };
    }

    return { verified: true, name: location.name ?? '' };
  } catch (error) {
    // Either way we refuse — if we can't confirm, nobody gets in, and an outage
    // must not become an open door. Only the reported reason differs.
    return { verified: false, reason: classify(error) };
  }
}
