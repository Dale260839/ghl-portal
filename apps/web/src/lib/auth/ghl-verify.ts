import { GhlClient } from '../ghl/client.ts';
import type { GhlConfig } from '../ghl/config.ts';

/**
 * Verifying a Custom Menu Link landing against the GHL API.
 *
 * **Why this exists.** A menu link hands us `locationId` and `userId` as plain
 * query parameters. GoHighLevel does not sign them, so on their own they are a
 * claim, not proof — anyone who learns the callback URL could supply a location
 * of their choosing, and because tenancy comes from the session, that means
 * choosing whose data to receive.
 *
 * So we treat the URL as an assertion and check it: ask GHL, using our own
 * credential, whether that user genuinely belongs to that location. A forged
 * `locationId` fails because the real user isn't in it. A forged `userId` fails
 * because it doesn't resolve.
 *
 * This is the same shape BuildSuite's own callback uses — its documentation
 * describes it as "validates the location, resolves or auto-creates".
 *
 * **What it does not prove.** That the person holding the browser *is* that
 * user. A leaked URL still works until it's rotated. GHL's Marketplace SSO
 * (encrypted user data) is the fix for that, and it's the reason this path is
 * labelled `api` rather than `sso` in the result — so the weaker guarantee is
 * visible wherever the proof is recorded.
 */

export interface GhlUser {
  id: string;
  email: string;
  name: string;
}

export type VerificationOutcome =
  | { verified: true; user: GhlUser }
  | { verified: false; reason: 'unknown_user' | 'wrong_location' | 'lookup_failed' };

interface GhlUserResponse {
  id?: string;
  email?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  /** Present on multi-location users. */
  locationIds?: string[];
  roles?: { locationIds?: string[] };
}

function displayName(user: GhlUserResponse): string {
  if (typeof user.name === 'string' && user.name.trim() !== '') return user.name;
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}

/**
 * Collects every location a user belongs to.
 *
 * GHL reports this in more than one place depending on how the user was
 * created, so both are checked. Reading only one would reject legitimate users
 * — and the failure would look like a security block rather than a parsing bug,
 * which is the worst kind to debug.
 */
function locationsOf(user: GhlUserResponse): string[] {
  return [...(user.locationIds ?? []), ...(user.roles?.locationIds ?? [])];
}

export async function verifyGhlUser(
  claim: { locationId: string; userId: string },
  config: GhlConfig,
  client?: GhlClient,
): Promise<VerificationOutcome> {
  const ghl = client ?? new GhlClient({ config });

  let user: GhlUserResponse;
  try {
    const response = await ghl.request<{ user?: GhlUserResponse } | GhlUserResponse>({
      path: `/users/${claim.userId}`,
      describe: `GHL user ${claim.userId}`,
    });
    // GHL wraps some responses and not others.
    const unwrapped = 'user' in response && response.user !== undefined ? response.user : response;
    user = unwrapped as GhlUserResponse;
  } catch {
    // A lookup failure is NOT treated as a pass. If we can't confirm, we refuse
    // — an outage must not become an open door.
    return { verified: false, reason: 'lookup_failed' };
  }

  if (typeof user.id !== 'string' || user.id === '') {
    return { verified: false, reason: 'unknown_user' };
  }

  const locations = locationsOf(user);
  if (locations.length > 0 && !locations.includes(claim.locationId)) {
    // The user exists but not in the location the URL claimed — which is
    // exactly what a forged landing looks like.
    return { verified: false, reason: 'wrong_location' };
  }

  return {
    verified: true,
    user: {
      id: user.id,
      email: (user.email ?? '').trim().toLowerCase(),
      name: displayName(user),
    },
  };
}
