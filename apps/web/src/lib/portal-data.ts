import 'server-only';

import { PROJECTS } from './data/fixtures.ts';
import type { Project } from './data/types.ts';
import { getSession } from './session.ts';
import { currentDataSource } from './data/current-source.ts';
import { projectFor } from './portal-gates.ts';

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

  if (session?.role === 'client' && session.contactId !== undefined) {
    const allProjects = await db.listProjectsForContact(session.contactId);
    const chosen =
      allProjects.find((p) => p.buildsuiteProjectId === params.project) ?? allProjects[0] ?? null;
    return { project: chosen, allProjects };
  }

  if (session?.role === 'contractor' && params.preview !== undefined) {
    const project = projectFor(params.preview);
    return { project, allProjects: project === null ? [] : [project] };
  }

  // A contractor browsing the portal without a preview id gets the first
  // project they own, so the nav is explorable rather than dead.
  if (session?.role === 'contractor' && session.authProfileIds !== undefined) {
    const owned = PROJECTS.filter((p) => session.authProfileIds!.includes(p.ownerAuthProfileId));
    return { project: owned[0] ?? null, allProjects: owned };
  }

  return { project: null, allProjects: [] };
}
