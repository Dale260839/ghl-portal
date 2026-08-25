import type { ManagerApprovalStatus, ProjectStage } from '@buildsuite/contracts';

/**
 * Workflows are planners, not doers.
 *
 * Each workflow is a pure function: trigger in, a list of typed effects out. It
 * touches no network, no clock, no database. The executor applies the effects
 * through ports (`ports.ts`).
 *
 * Why this shape, given D-002 moved WF1–WF8 out of GHL's workflow builder and
 * into code: §11 is still the specification even though it is no longer the
 * implementation. A planner that returns a list of effects can be asserted
 * against §11 line by line, with no credentials and no GHL sub-account. "Does
 * WF1 set progress to 10%?" becomes a unit test rather than a manual click-through
 * in a live account.
 */

export type Effect =
  // ── WF1 ────────────────────────────────────────────────────────────────────
  | { type: 'CreateProject'; buildsuiteProjectId: string; projectName: string; projectAddress: string; contractAmount: number; clientName: string }
  | { type: 'AssociateContact'; buildsuiteProjectId: string; contactId: string }
  | { type: 'AssociateOpportunity'; buildsuiteProjectId: string; opportunityId: string }
  | { type: 'AssignProjectManager'; buildsuiteProjectId: string; userId: string }
  | { type: 'CreateMilestone'; buildsuiteProjectId: string; milestoneName: string; sequence: number; clientVisible: boolean }
  | { type: 'CreateTask'; buildsuiteProjectId: string; taskName: string; assignedTrade: string }
  | { type: 'PrepareClientPortalAccess'; buildsuiteProjectId: string; contactId: string }
  // ── WF2 ────────────────────────────────────────────────────────────────────
  | { type: 'UpdateProjectStage'; buildsuiteProjectId: string; stage: ProjectStage }
  | { type: 'SetProgress'; buildsuiteProjectId: string; percentage: number }
  | { type: 'SetCurrentMilestone'; buildsuiteProjectId: string; milestoneName: string }
  | { type: 'SetNextMilestone'; buildsuiteProjectId: string; milestoneName: string }
  // ── WF3 ────────────────────────────────────────────────────────────────────
  | { type: 'SetManagerApprovalStatus'; buildsuiteProjectId: string; updateId: string; status: ManagerApprovalStatus }
  | { type: 'AddToReviewQueue'; buildsuiteProjectId: string; updateId: string }
  | { type: 'CreateIssue'; buildsuiteProjectId: string; issueTitle: string; category: string; description: string; priority: 'Normal' | 'Urgent' }
  | { type: 'SetClientActionRequired'; buildsuiteProjectId: string; required: boolean }
  // ── WF4 ────────────────────────────────────────────────────────────────────
  | { type: 'SetClientVisible'; buildsuiteProjectId: string; updateId: string; visible: boolean }
  | { type: 'PublishClientSummary'; buildsuiteProjectId: string; updateId: string; clientSummary: string; publishDate: string }
  | { type: 'SetProjectLastUpdated'; buildsuiteProjectId: string; date: string }
  | { type: 'AddToPortalFeed'; buildsuiteProjectId: string; updateId: string }
  // ── WF5 ────────────────────────────────────────────────────────────────────
  | { type: 'RecordSelectionApproval'; buildsuiteProjectId: string; selectionId: string; approvedDate: string; clientDecision: string }
  | { type: 'UpdateSelectionAmounts'; buildsuiteProjectId: string; selectionId: string; upgradeAmount: number; creditAmount: number }
  | { type: 'UpdateRelatedTask'; buildsuiteProjectId: string; taskId: string; status: string }
  | { type: 'CreateChangeOrderFromSelection'; buildsuiteProjectId: string; selectionId: string; title: string; addedCost: number }
  // ── WF6 ────────────────────────────────────────────────────────────────────
  | { type: 'RecordChangeOrderApproval'; buildsuiteProjectId: string; changeOrderId: string; approvedBy: string; approvalDate: string }
  | { type: 'UpdateApprovedChangeOrders'; buildsuiteProjectId: string; total: number }
  | { type: 'RecalculateProjectTotal'; buildsuiteProjectId: string; currentProjectTotal: number }
  | { type: 'AdjustCompletionDate'; buildsuiteProjectId: string; revisedCompletionDate: string }
  | { type: 'CreateInvoice'; buildsuiteProjectId: string; changeOrderId: string; amount: number }
  | { type: 'NotifyAccounting'; buildsuiteProjectId: string; message: string }
  | { type: 'UpdatePortal'; buildsuiteProjectId: string; reason: string }
  // ── WF7 ────────────────────────────────────────────────────────────────────
  | { type: 'AssignIssueNumber'; buildsuiteProjectId: string; issueId: string; issueNumber: string }
  | { type: 'AssignIssue'; buildsuiteProjectId: string; issueId: string; assignTo: string }
  | { type: 'ConfirmToReporter'; buildsuiteProjectId: string; issueId: string; reporter: string; message: string }
  | { type: 'EscalateIssue'; buildsuiteProjectId: string; issueId: string; reason: string }
  // ── Shared ─────────────────────────────────────────────────────────────────
  | { type: 'NotifyInternal'; buildsuiteProjectId: string; message: string }
  | { type: 'NotifyTeam'; buildsuiteProjectId: string; message: string }
  | { type: 'NotifyClient'; buildsuiteProjectId: string; contactId: string; message: string }
  | { type: 'RecordActivity'; buildsuiteProjectId: string; activity: string };

export type EffectType = Effect['type'];

/** A workflow either plans effects or explains why it declined to act. */
export type WorkflowPlan =
  | { ran: true; workflow: string; effects: Effect[] }
  | { ran: false; workflow: string; skipped: string };

export function effectsOfType<T extends EffectType>(
  effects: Effect[],
  type: T,
): Extract<Effect, { type: T }>[] {
  return effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type);
}
