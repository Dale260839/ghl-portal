import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF6 — Change Order Approval (§11).
 *
 * Trigger: Change Order → Approved.
 *
 * Actions, verbatim from §11: record approver + date · update
 * `Approved Change Orders` · recalculate `Current Project Total` · adjust
 * completion date when required · create invoice when configured · notify PM ·
 * notify accounting · update portal.
 *
 * This is the one workflow that moves a number the client can see. §9.3's
 * allow-list admits `Approved Change Orders` and `Current Project Total`, so
 * both totals are computed here and both are safe to display — but the arithmetic
 * has to be right, because a homeowner reading a wrong contract total is a
 * dispute rather than a bug report.
 *
 * `Tax` is part of the added cost per §6.6 and is included; the planner takes it
 * as its own field rather than assuming it was folded in already.
 */

export interface Wf6Trigger {
  buildsuiteProjectId: string;
  changeOrderId: string;
  changeOrderNumber: string;
  title: string;
  /** The status the change order just moved to. */
  status: string;
  approvedBy: string;
  /** §6.6 amounts. */
  addedCost: number;
  creditAmount: number;
  tax: number;
  /** Totals as they stand *before* this approval. */
  approvedChangeOrdersBefore: number;
  contractAmount: number;
  /** §6.6 — set when the change order moves the finish date. */
  revisedCompletionDate: string | null;
  /** §6.6 `Payment Requirement` — invoice now, or roll into the next draw. */
  invoiceOnApproval: boolean;
  contactId: string | null;
  clientPortalEnabled: boolean;
  /** ISO date. Passed in rather than read from a clock so the planner stays pure. */
  today: string;
}

export const WF6 = 'WF6 Change Order Approval';

const APPROVED = 'Approved';

/** Added cost plus tax, less any credit. The number that hits the contract. */
export function netChangeOrderAmount(t: Pick<Wf6Trigger, 'addedCost' | 'creditAmount' | 'tax'>): number {
  return t.addedCost + t.tax - t.creditAmount;
}

export function planChangeOrderApproved(trigger: Wf6Trigger): WorkflowPlan {
  if (trigger.status !== APPROVED) {
    return {
      ran: false,
      workflow: WF6,
      skipped: `status is "${trigger.status}", not "${APPROVED}" — no money moves`,
    };
  }

  const id = trigger.buildsuiteProjectId;
  const net = netChangeOrderAmount(trigger);
  const approvedTotal = trigger.approvedChangeOrdersBefore + net;
  const projectTotal = trigger.contractAmount + approvedTotal;

  const effects: Effect[] = [
    {
      type: 'RecordChangeOrderApproval',
      buildsuiteProjectId: id,
      changeOrderId: trigger.changeOrderId,
      approvedBy: trigger.approvedBy,
      approvalDate: trigger.today,
    },
    { type: 'UpdateApprovedChangeOrders', buildsuiteProjectId: id, total: approvedTotal },
    { type: 'RecalculateProjectTotal', buildsuiteProjectId: id, currentProjectTotal: projectTotal },
  ];

  if (trigger.revisedCompletionDate !== null) {
    effects.push({
      type: 'AdjustCompletionDate',
      buildsuiteProjectId: id,
      revisedCompletionDate: trigger.revisedCompletionDate,
    });
  }

  // §11 "create invoice when configured" — a credit-only change order bills
  // nobody, so there is nothing to invoice even when the flag is set.
  if (trigger.invoiceOnApproval && net > 0) {
    effects.push({
      type: 'CreateInvoice',
      buildsuiteProjectId: id,
      changeOrderId: trigger.changeOrderId,
      amount: net,
    });
  }

  effects.push(
    {
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `${trigger.changeOrderNumber} approved by ${trigger.approvedBy}.`,
    },
    {
      type: 'NotifyAccounting',
      buildsuiteProjectId: id,
      message: `${trigger.changeOrderNumber} approved — contract total is now ${projectTotal}.`,
    },
  );

  // §9.1 — the portal master switch still governs, exactly as in WF4. Updating a
  // disabled portal is a no-op, so telling the client to look at it points at
  // nothing.
  if (trigger.clientPortalEnabled) {
    effects.push({
      type: 'UpdatePortal',
      buildsuiteProjectId: id,
      reason: `${trigger.changeOrderNumber} approved`,
    });

    if (trigger.contactId !== null) {
      effects.push({
        type: 'NotifyClient',
        buildsuiteProjectId: id,
        contactId: trigger.contactId,
        message: `Change order ${trigger.changeOrderNumber} — ${trigger.title} — has been approved.`,
      });
    }
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Change order approved: ${trigger.changeOrderNumber}`,
  });

  return { ran: true, workflow: WF6, effects };
}
