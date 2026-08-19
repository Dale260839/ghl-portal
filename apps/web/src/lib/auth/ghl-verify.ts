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
  | { verified: false; reason: 'unknown_location' | 'lookup_failed' };

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
  } catch {
    // A lookup failure is NOT a pass. If we can't confirm, we refuse — an
    // outage must not become an open door.
    return { verified: false, reason: 'lookup_failed' };
  }
}
