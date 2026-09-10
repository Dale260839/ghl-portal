import 'server-only';

import { PROJECTS } from './data/fixtures.ts';
import type { Project } from './data/types.ts';
import { getSession } from './session.ts';
import { currentAccess } from './access.ts';
import { clientProjectsFor } from './client-scope.ts';
import { currentDataSource } from './data/current-source.ts';
import { projectFor } from './portal-gates.ts';
import { tenantScopeFor } from './tenant-scope.ts';

/**
 * Portal reads that need the request.
 *
 * The gates themselves are pure and live in `portal-gates.ts`; everything there
 * is re-exported here so screens keep importing from one place.
 */

export * from './portal-gates.ts';

// ── Resolving which project a portal request is about ───────────────────────

/**
 * The project the current portal request concerns.
 *
 * A client resolves it from their **session**, never from the URL — the
 * `project` query parameter only chooses among projects they already own. A
 * contractor previewing resolves it from the preview id, and the §9.1 gate still
 * runs downstream, so previewing demonstrates the rule instead of bypassing it.
 */
export async function currentPortalProject(params: {
  project?: string;
  preview?: string;
}): Promise<{ project: Project | null; allProjects: Project[] }> {
  const session = await getSession();
  const db = await currentDataSource();

  if (session?.role === 'client') {
    // THROUGH `clientProjectsFor`, WHICH KNOWS ABOUT BOTH KINDS OF CLIENT.
    //
    // This used to be `db.listProjectsForContact(session.contactId)` guarded by
    // `session.contactId !== undefined`, which handled exactly one of the two:
    // the homeowner already in GoHighLevel. A homeowner who arrived by
    // invitation — and, since 2026-09-10, EVERY homeowner, because a code
    // sign-in deliberately mints no contact id — fell straight past the branch
    // and got `{ project: null }`.
    //
    // Eleven of the fourteen portal screens resolve their project here, so the
    // effect was a homeowner signing in successfully and finding "No project"
    // on Documents, Photos, Schedule, Budget, Timeline, Updates, Issues,
    // Messages, Designs, Change Orders and Completion — every screen except the
    // three that already went through `clientProjectsFor`. Silent, and it looks
    // like the contractor has shared nothing rather than like a fault.
    const access = await currentAccess();
    if (!access.ok) return { project: null, allProjects: [] };

    const allProjects = await clientProjectsFor(access.access, db);
    const chosen =
      allProjects.find((p) => p.buildsuiteProjectId === params.project) ?? allProjects[0] ?? null;
    return { project: chosen, allProjects };
  }

  if (session?.role === 'contractor') {
    // A contractor's preview is read through their own tenant scope, so a live
    // BuildSuite id resolves as readily as a fixture id. Until 8 Sep this only
    // consulted the fixtures, and "Preview client view" on a real project showed
    // "No project". The §9.1 gate still runs downstream; this only chooses which
    // project it runs against. Fixtures remain the fallback so the demo data
    // keeps working where BuildSuite is not reachable.
    const scope = await tenantScopeFor(session);
    const scoped = scope === null ? null : await currentDataSource(scope);

    if (params.preview !== undefined) {
      const live = scoped === null || scope === null ? null : await scoped.getProject(scope, params.preview);
      const project = live ?? projectFor(params.preview);
      return { project, allProjects: project === null ? [] : [project] };
    }

    // No preview id: the first project they own, so the nav is explorable
    // rather than dead.
    if (scoped !== null && scope !== null) {
      const owned = await scoped.listProjects(scope);
      if (owned.length > 0) return { project: owned[0] ?? null, allProjects: owned };
    }
    if (session.authProfileIds !== undefined) {
      const owned = PROJECTS.filter((p) => session.authProfileIds!.includes(p.ownerAuthProfileId));
      return { project: owned[0] ?? null, allProjects: owned };
    }
  }

  return { project: null, allProjects: [] };
}
