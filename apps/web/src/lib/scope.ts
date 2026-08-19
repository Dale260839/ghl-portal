import 'server-only';

import { redirect } from 'next/navigation';
import { getSession } from './session.ts';
import type { TenantScope } from './tenancy.ts';
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
export async function requireTenantScope(): Promise<TenantScope> {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.authProfileIds === undefined || session.authProfileIds.length === 0) {
    // Signed in, but not linked to a BuildSuite profile — so there is no tenant
    // whose data they could see. Sending them back beats showing an empty
    // dashboard that looks like a bug.
    redirect('/?error=no-profile');
  }
  return {
    locationId: session.ghlLocationId ?? '',
    authProfileIds: session.authProfileIds,
  };
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
