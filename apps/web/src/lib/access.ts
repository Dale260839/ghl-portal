import 'server-only';

import { cache } from 'react';
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
  /**
   * The projects this person was assigned, or `null` for no restriction.
   *
   * The distinction matters and is not cosmetic: `null` is a contractor, who
   * sees everything of their own; `[]` is an invited person who has been given
   * nothing yet, and must see nothing. Collapsing the two either blanks the
   * contractor's dashboard or shows a new crew member every job on the books.
   *
   * Read live from the membership on each request rather than carried in the
   * cookie, so assigning a project takes effect on the next page load instead
   * of the next sign-in.
   */
  projectIds: string[] | null;
  can: (action: Action, resource: Resource) => boolean;
}

export type AccessResult =
  | { ok: true; access: Access }
  | { ok: false; reason: 'signed-out' | 'revoked' };

/**
 * Deduped per request: the layout and the page both need this, and it costs a
 * membership read. `cache` scopes to one render pass, so assignment stays live
 * between requests while a single navigation reads it once.
 */
export const currentAccess: () => Promise<AccessResult> = cache(async () => {
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
        projectIds: null,
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
      projectIds: current.membership.projectIds,
      can: (action, resource) => effectiveCan(role, action, resource, current.grants),
    },
  };
});

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
