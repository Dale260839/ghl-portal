import 'server-only';

import { redirect } from 'next/navigation';

import { getSession } from './session.ts';
import { getHubTeam } from './hub-db/team.ts';
import { effectiveCan, type Action, type Resource } from './permissions.ts';
import type { Role, Session } from './demo-accounts.ts';

/**
 * What the signed-in person may actually see, right now.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RE-READS THE DATABASE INSTEAD OF TRUSTING THE SESSION
 *
 * A session lasts eight hours. A contractor who revokes someone's access, or
 * unticks a resource, expects that to take effect immediately — not whenever
 * the person next logs in. If the grants were baked into the session cookie,
 * "revoke" would mean "revoke, eventually, probably tomorrow", which is not
 * what the button says.
 *
 * So for an invited user the session is an identity claim and nothing more.
 * Authority is re-established per request from `hub_memberships`. One small
 * indexed query is the price of revocation meaning what it says.
 *
 * Sessions WITHOUT a `membershipId` — the contractor who came in through
 * GoHighLevel, and the demo identities — skip this entirely. They have no
 * membership row to check, and their permissions are their role's.
 * ---------------------------------------------------------------------------
 */

export interface Access {
  session: Session;
  role: Role;
  /** Empty for a GHL-authenticated contractor: nothing narrows their role. */
  grants: Record<string, boolean>;
  /** True when this person arrived through an invitation. */
  invited: boolean;
  can: (action: Action, resource: Resource) => boolean;
}

export type AccessResult =
  | { ok: true; access: Access }
  | { ok: false; reason: 'signed-out' | 'revoked' };

export async function currentAccess(): Promise<AccessResult> {
  const session = await getSession();
  if (session === null) return { ok: false, reason: 'signed-out' };

  const membershipId = session.membershipId;
  if (membershipId === undefined) {
    return {
      ok: true,
      access: {
        session,
        role: session.role,
        grants: {},
        invited: false,
        can: (action, resource) => effectiveCan(session.role, action, resource),
      },
    };
  }

  const hub = getHubTeam();
  if (!hub.available) {
    // The membership cannot be checked, so it cannot be honoured. Failing
    // closed here means an outage locks invited users out rather than handing
    // them un-narrowed access — the safe direction of a bad situation.
    return { ok: false, reason: 'revoked' };
  }

  const current = await hub.team.currentAccess(membershipId);
  if (current === null) return { ok: false, reason: 'revoked' };

  // The ROLE comes from the database too, not from the cookie. Otherwise a
  // stale session would keep a role a contractor had since changed.
  const role = current.membership.role;

  return {
    ok: true,
    access: {
      session: { ...session, role },
      role,
      grants: current.grants,
      invited: true,
      can: (action, resource) => effectiveCan(role, action, resource, current.grants),
    },
  };
}

/**
 * The page-level form: redirects rather than returning, because every caller's
 * answer to "no access" is the same — send them to the front door.
 */
export async function requireAccess(): Promise<Access> {
  const result = await currentAccess();
  if (result.ok) return result.access;

  // `redirect` throws, so control never returns — but TypeScript cannot see
  // that through a conditional, hence the explicit throw shape.
  redirect(result.reason === 'revoked' ? '/?error=access-revoked' : '/');
}
