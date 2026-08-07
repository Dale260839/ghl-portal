import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF3 — Field Update Submitted (§11).
 *
 * Trigger: a `Daily Update` is created by a field user.
 *
 * Actions, verbatim from §11: set `Manager Approval Status = Pending` · notify
 * PM · add to dashboard review queue · if blocker → create Issue · if client
 * decision needed → create client-action item · **do not notify client**.
 *
 * That last one is the whole point of the workflow existing. §3.2: field updates
 * MUST NOT be auto-published. WF3 is the half of the loop that stops at the PM.
 */

export interface Wf3Trigger {
  buildsuiteProjectId: string;
  updateId: string;
  submittedBy: string;
  projectName: string;
  /** Free text from the field. Non-empty means work is blocked. */
  blocker?: string;
  /** The field user flagged that the client has to decide something. */
  clientDecisionNeeded?: boolean;
  /** Set when the update reports a safety issue — escalates the issue priority. */
  safetyConcern?: boolean;
}

export const WF3 = 'WF3 Field Update Submitted';

export function planFieldUpdateSubmitted(trigger: Wf3Trigger): WorkflowPlan {
  if (trigger.buildsuiteProjectId === '' || trigger.updateId === '') {
    return {
      ran: false,
      workflow: WF3,
      skipped: 'daily update is missing a project id or update id',
    };
  }

  const id = trigger.buildsuiteProjectId;

  const effects: Effect[] = [
    // Pending, never Approved. A submission is a request for review.
    {
      type: 'SetManagerApprovalStatus',
      buildsuiteProjectId: id,
      updateId: trigger.updateId,
      status: 'Pending',
    },
    { type: 'AddToReviewQueue', buildsuiteProjectId: id, updateId: trigger.updateId },
    {
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `${trigger.submittedBy} submitted a field update on ${trigger.projectName} — awaiting your review`,
    },
  ];

  if (trigger.blocker !== undefined && trigger.blocker.trim() !== '') {
    effects.push({
      type: 'CreateIssue',
      buildsuiteProjectId: id,
      issueTitle: `Blocker reported on ${trigger.projectName}`,
      // §6.7 category enum, verbatim.
      category: trigger.safetyConcern === true ? 'Safety Concern' : 'Other',
      description: trigger.blocker,
      // §11 WF7 escalates urgent safety concerns; flagging it here means the
      // issue arrives already prioritised rather than waiting on triage.
      priority: trigger.safetyConcern === true ? 'Urgent' : 'Normal',
    });
  }

  if (trigger.clientDecisionNeeded === true) {
    effects.push({ type: 'SetClientActionRequired', buildsuiteProjectId: id, required: true });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Field update submitted by ${trigger.submittedBy}`,
  });

  // §11 is explicit: WF3 does NOT notify the client. Note the absence of any
  // NotifyClient effect above — asserted in the tests, because this is exactly
  // the kind of thing a well-meaning change adds later.
  return { ran: true, workflow: WF3, effects };
}
