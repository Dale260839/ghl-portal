import 'server-only';

import { assignedProjectIds, projectsForField, visibleProjectIds } from './field-data.ts';
import type { Access } from './access.ts';
import type { FieldProject } from './field-data.ts';
import type { Project, Task } from './data/types.ts';

/**
 * The projects a field screen may show, in one place.
 *
 * Four screens computed this independently and would have drifted apart the
 * first time the rule changed — which it just did, twice. The rule itself stays
 * in `field-data.ts` as pure functions; this is only the part needing a session.
 *
 * `access.projectIds === null` is a contractor previewing the field view
 * through "Viewing as". They hold no membership and so no assignment list, and
 * the honest preview of their own jobs is all of them — the reads are already
 * scoped to their tenant, so nothing widens. §9.4 is about what a CREW MEMBER
 * may see; it is not a rule about a contractor looking at their own work. The
 * money projection still applies either way, because that is `toFieldProject`
 * and every path goes through it.
 */
export function fieldProjectsFor(access: Access, projects: Project[], tasks: Task[]): FieldProject[] {
  const ids =
    access.projectIds === null
      ? projects.map((p) => p.buildsuiteProjectId)
      : visibleProjectIds(
          access.projectIds,
          assignedProjectIds(tasks, access.session.membershipId ?? ''),
        );

  return projectsForField(projects, ids);
}
