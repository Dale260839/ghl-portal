import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF5 — Selection Approval (§11).
 *
 * Trigger: Selection status → Approved.
 *
 * Actions, verbatim from §11: record approval date · notify PM · update related
 * task · update upgrade/credit amount · create Change Order when required ·
 * clear client-action alert.
 *
 * **`Actual Cost` is never read here.** §6.5 marks it internal and §9.3 puts it
 * on the deny-list, so this planner works from `Allowance`, `Upgrade Amount` and
 * `Credit Amount` only — the client-visible three. A value never read cannot
 * leak through a later refactor, which is the same reason WF4 never touches
 * `Internal Notes`.
 */

export interface Wf5Trigger {
  buildsuiteProjectId: string;
  selectionId: string;
  selectionName: string;
  /** The status the selection just moved to. */
  status: string;
  /** What the client actually chose — Approved / Rejected / Changes Requested. */
  clientDecision: string;
  /** §6.5 client-visible amounts. `Actual Cost` is deliberately absent. */
  allowance: number;
  upgradeAmount: number;
  creditAmount: number;
  /** A selection that costs more than its allowance needs a change order. */
  requiresChangeOrder: boolean;
  /** The install/order task this selection gates, if there is one. */
  relatedTaskId: string | null;
  /** ISO date. Passed in rather than read from a clock so the planner stays pure. */
  today: string;
  /** Whether any other selection is still waiting on this client. */
  otherSelectionsAwaitingClient: boolean;
}

export const WF5 = 'WF5 Selection Approval';

const APPROVED = 'Approved';

export function planSelectionApproved(trigger: Wf5Trigger): WorkflowPlan {
  if (trigger.status !== APPROVED) {
    return {
      ran: false,
      workflow: WF5,
      skipped: `status is "${trigger.status}", not "${APPROVED}" — nothing is approved`,
    };
  }

  const id = trigger.buildsuiteProjectId;

  const effects: Effect[] = [
    {
      type: 'RecordSelectionApproval',
      buildsuiteProjectId: id,
      selectionId: trigger.selectionId,
      approvedDate: trigger.today,
      clientDecision: trigger.clientDecision,
    },
    {
      type: 'UpdateSelectionAmounts',
      buildsuiteProjectId: id,
      selectionId: trigger.selectionId,
      upgradeAmount: trigger.upgradeAmount,
      creditAmount: trigger.creditAmount,
    },
    {
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `${trigger.selectionName} approved by the client.`,
    },
  ];

  if (trigger.relatedTaskId !== null) {
    effects.push({
      type: 'UpdateRelatedTask',
      buildsuiteProjectId: id,
      taskId: trigger.relatedTaskId,
      status: 'Ready',
    });
  }

  // §11 says "create Change Order when required". Required means the client
  // chose above their allowance: somebody has to agree to pay the difference,
  // and that agreement is what a change order is.
  if (trigger.requiresChangeOrder) {
    const addedCost = trigger.upgradeAmount - trigger.creditAmount;
    effects.push({
      type: 'CreateChangeOrderFromSelection',
      buildsuiteProjectId: id,
      selectionId: trigger.selectionId,
      title: `Upgrade — ${trigger.selectionName}`,
      addedCost,
    });
  }

  // Clear the alert only when nothing else is waiting on them. Clearing it while
  // three other selections are outstanding tells the client they are done when
  // they are not.
  if (!trigger.otherSelectionsAwaitingClient) {
    effects.push({ type: 'SetClientActionRequired', buildsuiteProjectId: id, required: false });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Selection approved: ${trigger.selectionName}`,
  });

  return { ran: true, workflow: WF5, effects };
}
