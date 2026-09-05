import 'server-only';

import { resolveContractor } from './buildsuite/contractor-identity.ts';
import { locationForAuthProfiles } from './buildsuite/profile-location.ts';
import type { TenantScope } from './tenancy.ts';
import type { Session } from './demo-accounts.ts';

/**
 * Split out of `scope.ts` on 2026-09-03 so it can be TESTED.
 *
 * `scope.ts` imports `next/navigation` for its redirects, which cannot load
 * outside a Next runtime — so the integration test that walks the invited-user
 * path had to keep its own copy of this logic. A copy of the rule is exactly
 * what drifts, and drift in this function is what produced two of the four
 * defects it exists to catch. Nothing here redirects; the callers do.
 */
/**
 * The one place a scope is built from a session.
 *
 * Six call sites used to assemble this by hand, and every one of them broke the
 * same way for an invited member: they read `session.ghlLocationId`, which only
 * a GoHighLevel sign-in ever sets, so the location was blank and `assertScope`
 * refused. Fixing `requireTenantScope` alone fixed the pages and left every
 * server action throwing — submitting a field update still failed after the
 * screens had started working.
 *
 * Returns null rather than throwing, so each caller can fail in the way that
 * suits it: a page redirects, an action throws.
 */
/**
 * The two things this needs from the outside world, injectable so the function
 * can be tested without credentials.
 *
 * Production never passes them. They exist because the integration test that
 * walks the invited-user path was keeping its own COPY of this logic, and a
 * copy of a rule is what drifts — drift here produced two of the four defects
 * that test exists to catch.
 */
export interface TenantScopeDeps {
  lookupLocation: (authProfileIds: readonly string[]) => Promise<string | null>;
  lookupContractorId: (scope: TenantScope) => Promise<string | null>;
}

const LIVE: TenantScopeDeps = {
  lookupLocation: (ids) => locationForAuthProfiles(ids),
  lookupContractorId: async (scope) => {
    const identity = await resolveContractor(scope);
    return identity.resolved ? identity.identity.contractorId : null;
  },
};

export async function tenantScopeFor(
  session: Session,
  deps: TenantScopeDeps = LIVE,
): Promise<TenantScope | null> {
  const authProfileIds = session.authProfileIds;
  if (authProfileIds === undefined || authProfileIds.length === 0) return null;

  // The location, which an invited member's session does not carry: they never
  // signed in through GoHighLevel, so nothing put one in their cookie. It is
  // read from the auth profile they inherited rather than stored again.
  let locationId = (session.ghlLocationId ?? '').trim();
  if (locationId === '') {
    locationId = (await deps.lookupLocation(authProfileIds)) ?? '';
  }
  if (locationId === '') return null;

  const base: TenantScope = { locationId, authProfileIds };

  // Resolve the contractor once per request rather than in every screen. It is
  // a different id from the auth profile and the Hub's tables are filed under
  // it; see `assertContractor`. Absent is a legitimate state — seven profiles
  // do not resolve — and Hub reads then return nothing rather than guessing.
  const contractorId = await deps.lookupContractorId(base);
  return contractorId === null ? base : { ...base, contractorId };
}
