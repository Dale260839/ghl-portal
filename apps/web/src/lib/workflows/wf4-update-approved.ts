import { PUBLISHED_APPROVAL_STATUS, type ManagerApprovalStatus } from '@buildsuite/contracts';
import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF4 — Field Update Approved (§11).
 *
 * Trigger: `Manager Approval Status` becomes `Approved & Published`.
 *
 * Actions, verbatim from §11: set `Client Visible = Yes` · publish Client
 * Summary · update `Project.Last Updated Date` · notify client · add to portal
 * feed.
 *
 * This is the only path in the entire system that makes a field update visible
 * to a client (§10). Everything it publishes is the `Client Summary`; the
 * `Internal Notes` field is not read here at all — not filtered, not stripped,
 * simply never touched. That is deliberate: a value that is never read cannot
 * leak through a future refactor.
 */

export interface Wf4Trigger {
  buildsuiteProjectId: string;
  updateId: string;
  /** The status the update just moved to. */
  managerApprovalStatus: ManagerApprovalStatus;
  /** PM-edited summary — the only publish candidate (§12.2). */
  clientSummary: string;
  contactId: string | null;
  projectName: string;
  /** ISO date. Passed in rather than read from a clock so the planner stays pure. */
  today: string;
  /** The per-project master switch, a clause of the §9.1 gate. */
  clientPortalEnabled: boolean;
  /** PM's `Notify Client` checkbox on the update (§6.4). */
  notifyClient?: boolean;
}

export const WF4 = 'WF4 Field Update Approved';

export function planFieldUpdateApproved(trigger: Wf4Trigger): WorkflowPlan {
  if (trigger.managerApprovalStatus !== PUBLISHED_APPROVAL_STATUS) {
    // §10 — `Approved Internally` is NOT a trigger for this workflow. It is the
    // single easiest rule in the system to get wrong: two of the four approval
    // values contain the word "Approved", and only one of them reaches a client.
    return {
      ran: false,
      workflow: WF4,
      skipped: `status is "${trigger.managerApprovalStatus}", not "${PUBLISHED_APPROVAL_STATUS}" — nothing is published`,
    };
  }

  if (trigger.clientSummary.trim() === '') {
    // Publishing an empty summary would show the client a blank update. The PM
    // has to write something before it goes out.
    return {
      ran: false,
      workflow: WF4,
      skipped: 'client summary is empty — nothing to publish',
    };
  }

  const id = trigger.buildsuiteProjectId;

  const effects: Effect[] = [
    { type: 'SetClientVisible', buildsuiteProjectId: id, updateId: trigger.updateId, visible: true },
    {
      type: 'PublishClientSummary',
      buildsuiteProjectId: id,
      updateId: trigger.updateId,
      clientSummary: trigger.clientSummary,
      publishDate: trigger.today,
    },
    { type: 'SetProjectLastUpdated', buildsuiteProjectId: id, date: trigger.today },
  ];

  // §9.1 — even at the moment of publishing, the portal master switch still
  // governs. Publishing into a disabled portal is a no-op the client never
  // sees, so notifying them would point at nothing.
  if (trigger.clientPortalEnabled) {
    effects.push({ type: 'AddToPortalFeed', buildsuiteProjectId: id, updateId: trigger.updateId });

    if (trigger.contactId !== null && trigger.notifyClient !== false) {
      effects.push({
        type: 'NotifyClient',
        buildsuiteProjectId: id,
        contactId: trigger.contactId,
        message: `New progress update on ${trigger.projectName}.`,
      });
    }
  } else {
    effects.push({
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `Update published on ${trigger.projectName}, but the client portal is disabled — the client will not see it`,
    });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: 'Field update approved and published to the client',
  });

  return { ran: true, workflow: WF4, effects };
}
