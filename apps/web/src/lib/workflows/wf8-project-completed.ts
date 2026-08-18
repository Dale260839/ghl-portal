import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF8 — Project Completed (§11).
 *
 * Trigger: `Project Stage` becomes `Completed`.
 *
 * Actions, verbatim from §11: set Progress = 100% · open final documents · send
 * final invoice · create punch-list review · deliver warranty info · set warranty
 * dates · request client review · move the project into Warranty.
 *
 * The ordering matters and isn't arbitrary. Warranty dates are set **before** the
 * stage moves to Warranty, because a project sitting in Warranty with no warranty
 * period is a support call. And the review request comes last — asking for a
 * review in the same breath as the final invoice reads badly.
 */

export interface Wf8Trigger {
  buildsuiteProjectId: string;
  projectName: string;
  contactId: string | null;
  /** ISO date. Passed in rather than read from a clock so the planner is pure. */
  completedOn: string;
  /** Warranty length. §11 requires dates but never states a duration — see below. */
  warrantyMonths?: number;
  /** Outstanding balance, if any. Drives whether a final invoice is sent. */
  remainingBalance: number;
  /** Open punch-list items at completion. */
  openPunchListItems: number;
  clientPortalEnabled: boolean;
}

export const WF8 = 'WF8 Project Completed';

/**
 * PROVISIONAL — §11 requires warranty dates but never states a duration. Twelve
 * months is the common default for residential remodelling in the US, and it is
 * a parameter rather than a constant so a contractor's actual terms override it.
 * Listed with W1–W3 in KICKOFF §5.
 */
export const DEFAULT_WARRANTY_MONTHS = 12;

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  // Day 0 of the following month gives that month's length, which clamps
  // 31 Jan + 1 month to 28/29 Feb instead of rolling into March.
  const targetMonthLength = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  const day = Math.min(d, targetMonthLength);
  const date = new Date(Date.UTC(y, m - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

export function planProjectCompleted(trigger: Wf8Trigger): WorkflowPlan {
  if (trigger.buildsuiteProjectId === '') {
    return { ran: false, workflow: WF8, skipped: 'no project id' };
  }

  const id = trigger.buildsuiteProjectId;
  const months = trigger.warrantyMonths ?? DEFAULT_WARRANTY_MONTHS;
  const warrantyEnds = addMonths(trigger.completedOn, months);

  const effects: Effect[] = [
    { type: 'SetProgress', buildsuiteProjectId: id, percentage: 100 },
    { type: 'SetProjectLastUpdated', buildsuiteProjectId: id, date: trigger.completedOn },
  ];

  // Punch list before closeout. Marking a project complete with open punch-list
  // items is exactly the thing a client notices and a contractor doesn't.
  if (trigger.openPunchListItems > 0) {
    effects.push({
      type: 'CreateTask',
      buildsuiteProjectId: id,
      taskName: `Punch list review — ${trigger.openPunchListItems} item(s) still open at completion`,
      assignedTrade: 'General',
    });
    effects.push({
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `${trigger.projectName} completed with ${trigger.openPunchListItems} open punch-list item(s)`,
    });
  }

  if (trigger.remainingBalance > 0) {
    effects.push({
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `Send the final invoice for ${trigger.projectName} — ${trigger.remainingBalance} outstanding`,
    });
  }

  // Warranty dates BEFORE the stage change, so the project is never in Warranty
  // without a warranty period.
  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Warranty ${trigger.completedOn} → ${warrantyEnds} (${months} months)`,
  });
  effects.push({ type: 'UpdateProjectStage', buildsuiteProjectId: id, stage: 'Warranty' });

  if (trigger.clientPortalEnabled && trigger.contactId !== null) {
    effects.push({
      type: 'NotifyClient',
      buildsuiteProjectId: id,
      contactId: trigger.contactId,
      message: `${trigger.projectName} is complete. Your warranty runs to ${warrantyEnds}, and your final documents are available in your portal.`,
    });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: 'Project completed — moved to Warranty',
  });

  return { ran: true, workflow: WF8, effects };
}
