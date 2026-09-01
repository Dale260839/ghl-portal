import 'server-only';

import { redirect } from 'next/navigation';
import { getSession } from './session.ts';
import type { Session } from './demo-accounts.ts';
import { TenancyError, type TenantScope } from './tenancy.ts';
import { resolveContractor } from './buildsuite/contractor-identity.ts';
import { locationForAuthProfiles } from './buildsuite/profile-location.ts';
import type { Project } from './data/types.ts';

/**
 * Getting a tenant scope out of a request.
 *
 * One function per legitimate path, so there is no generic "give me a scope"
 * that a caller can reach for when they don't have one.
 */

/**
 * Staff path — contractor and field users. Redirects rather than returning null,
 * because every caller is a page and every page's answer to "no scope" is the
 * same: you are not signed in enough to be here.
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
export async function tenantScopeFor(session: Session): Promise<TenantScope | null> {
  const authProfileIds = session.authProfileIds;
  if (authProfileIds === undefined || authProfileIds.length === 0) return null;

  // The location, which an invited member's session does not carry: they never
  // signed in through GoHighLevel, so nothing put one in their cookie. It is
  // read from the auth profile they inherited rather than stored again.
  let locationId = (session.ghlLocationId ?? '').trim();
  if (locationId === '') {
    locationId = (await locationForAuthProfiles(authProfileIds)) ?? '';
  }
  if (locationId === '') return null;

  const base: TenantScope = { locationId, authProfileIds };

  // Resolve the contractor once per request rather than in every screen. It is
  // a different id from the auth profile and the Hub's tables are filed under
  // it; see `assertContractor`. Absent is a legitimate state — seven profiles
  // do not resolve — and Hub reads then return nothing rather than guessing.
  const identity = await resolveContractor(base);
  return identity.resolved ? { ...base, contractorId: identity.identity.contractorId } : base;
}

/**
 * Staff path — contractor and field users. Redirects rather than returning null,
 * because every caller is a page and every page's answer to "no scope" is the
 * same: you are not signed in enough to be here.
 */
export async function requireTenantScope(): Promise<TenantScope> {
  const session = await getSession();
  if (session === null) redirect('/');

  const scope = await tenantScopeFor(session);
  if (scope === null) {
    // Signed in, but with no tenant to read under — either no BuildSuite
    // profile, or a profile that names no sub-account. Sending them back beats
    // showing an empty dashboard that looks like a bug.
    redirect('/?error=no-profile');
  }
  return scope;
}

/**
 * Server-action path. Throws instead of redirecting: an action has already
 * decided the caller is signed in, and a silent redirect mid-write would look
 * like the write succeeded.
 */
export async function actionTenantScope(session: Session): Promise<TenantScope> {
  const scope = await tenantScopeFor(session);
  if (scope === null) {
    throw new TenancyError('this account — it has no BuildSuite profile or no location');
  }
  return scope;
}

/**
 * Client path — a homeowner is not a tenant, so they cannot supply a scope.
 *
 * Instead: the project they are already authorized to see (via
 * `listProjectsForContact` plus the §9.1 gate) supplies the scope for reading
 * its own children. The authorization has happened by the time this is called;
 * this only says *which tenant's* rows the children live under.
 *
 * Takes a whole `Project` rather than an id on purpose — you can only call it if
 * you already hold a project you were allowed to read.
 */
export function scopeOfProject(project: Project): TenantScope {
  return {
    locationId: project.ghlLocationId,
    authProfileIds: [project.ownerAuthProfileId],
  };
}
