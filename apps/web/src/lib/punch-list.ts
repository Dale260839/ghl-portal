import { PUNCH_LIST } from './data/portal-fixtures.ts';
import { punchItemDone } from './data/types.ts';
import type { Project, PunchListItem } from './data/types.ts';
import type { Wf8Trigger } from './workflows/wf8-project-completed.ts';

/**
 * Punch-list reads for the internal side, and the WF8 wiring.
 *
 * Deliberately separate from `portal-gates.ts`. That file answers "what may the
 * homeowner see" and returns a `ClientPunchItem` with `internalNotes` stripped.
 * This one answers "what does the office know", so it returns whole records and
 * counts items the client was never shown.
 *
 * **That distinction is the point of `openPunchItemCount`.** WF8 raises an
 * internal punch-list review task when a project completes with items still
 * open. An item the PM withheld from the portal is still outstanding work, so
 * counting only client-visible ones would let a project close with real snags
 * uncounted — the exact thing §11 asks WF8 to catch.
 */

/** Every punch item on a project, internal ones included. Office-side read. */
export function allPunchItemsFor(projectId: string): PunchListItem[] {
  return PUNCH_LIST.filter((p) => p.projectId === projectId).sort((a, b) =>
    a.itemNumber.localeCompare(b.itemNumber),
  );
}

/** The items still outstanding — anything not Completed or Verified. */
export function openPunchItems(items: readonly PunchListItem[]): PunchListItem[] {
  return items.filter((p) => !punchItemDone(p));
}

/**
 * How many items are still open on a project.
 *
 * Counts withheld items too — see the note above. This is the number WF8's
 * `openPunchListItems` has been expecting from the start, and until now nothing
 * computed it.
 */
export function openPunchItemCount(projectId: string): number {
  return openPunchItems(allPunchItemsFor(projectId)).length;
}

/**
 * Builds WF8's trigger from a project (§11).
 *
 * `completedOn` is a **parameter, not a clock read and not our decision**. D4 §5
 * and CLAUDE.md rule 1: GoHighLevel owns stage movement and the Hub reflects it.
 * So the completion date arrives from the GHL event that reports the project
 * completed; this function never concludes that a project is finished, it only
 * assembles the facts WF8 needs once something else has said so.
 *
 * `items` is injectable so the derivation can be tested without fixtures.
 */
export function wf8TriggerFor(
  project: Project,
  completedOn: string,
  items: readonly PunchListItem[] = allPunchItemsFor(project.buildsuiteProjectId),
): Wf8Trigger {
  return {
    buildsuiteProjectId: project.buildsuiteProjectId,
    projectName: project.projectName,
    // §1.4 — a contact may hold many projects; this is the project's primary
    // contact, and an empty id means nobody to notify rather than a guess.
    contactId: project.primaryContactId === '' ? null : project.primaryContactId,
    completedOn,
    remainingBalance: project.remainingBalance,
    openPunchListItems: openPunchItems(items).length,
    clientPortalEnabled: project.clientPortalEnabled,
  };
}
