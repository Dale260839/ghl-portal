import { DAILY_UPDATES, ISSUES, PROJECTS } from '../data/fixtures.ts';
import { CHANGE_ORDERS, SELECTIONS } from '../data/portal-fixtures.ts';
import type { Effect } from './effects.ts';
import type { EffectHandlers } from './ports.ts';

/**
 * Effect handlers backed by the fixture arrays.
 *
 * This is what makes the demo's publish button run the real WF4 rather than a
 * parallel code path that happens to look similar. When the GHL write path
 * exists, a `ghlPorts` module implements the same `EffectHandlers` type and the
 * workflows don't change at all.
 *
 * Effects with no fixture equivalent (notifications, portal feed, review queue)
 * are logged rather than silently dropped — during a demo it's useful to see in
 * the terminal that the workflow *would* have notified someone.
 */

const log = (effect: Effect, detail = '') => {
  // eslint-disable-next-line no-console
  console.log(`[workflow] ${effect.type}${detail === '' ? '' : ` — ${detail}`}`);
};

function update(updateId: string) {
  return DAILY_UPDATES.find((u) => u.id === updateId);
}

function selection(selectionId: string) {
  return SELECTIONS.find((x) => x.id === selectionId);
}

function changeOrder(changeOrderId: string) {
  return CHANGE_ORDERS.find((x) => x.id === changeOrderId);
}

function project(buildsuiteProjectId: string) {
  return PROJECTS.find((p) => p.buildsuiteProjectId === buildsuiteProjectId);
}

export const fixturePorts: EffectHandlers = {
  // ── WF3 / WF4 — the ones with real fixture state behind them ───────────────
  SetManagerApprovalStatus: (e) => {
    const row = update(e.updateId);
    if (row !== undefined) row.managerApprovalStatus = e.status;
  },
  SetClientVisible: (e) => {
    const row = update(e.updateId);
    if (row !== undefined) row.clientVisible = e.visible;
  },
  PublishClientSummary: (e) => {
    const row = update(e.updateId);
    if (row === undefined) return;
    row.clientSummary = e.clientSummary;
    row.publishDate = e.publishDate;
  },
  SetProjectLastUpdated: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.lastUpdatedDate = e.date;
  },
  SetClientActionRequired: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.clientActionRequired = e.required;
  },

  // ── WF7 ───────────────────────────────────────────────────────────────────
  AssignIssueNumber: (e) => {
    const issue = ISSUES.find((i) => i.id === e.issueId);
    if (issue !== undefined) issue.issueNumber = e.issueNumber;
  },
  AssignIssue: (e) => {
    const issue = ISSUES.find((i) => i.id === e.issueId);
    if (issue !== undefined) {
      issue.assignedTo = e.assignTo;
      issue.status = 'Assigned';
    }
  },
  ConfirmToReporter: (e) => log(e, `${e.reporter}: ${e.message}`),
  EscalateIssue: (e) => log(e, e.reason),

  // ── No fixture equivalent yet — logged, not dropped ────────────────────────
  AddToReviewQueue: (e) => log(e, e.updateId),
  AddToPortalFeed: (e) => log(e, e.updateId),
  CreateIssue: (e) => log(e, `${e.priority}: ${e.issueTitle}`),
  NotifyInternal: (e) => log(e, e.message),
  NotifyTeam: (e) => log(e, e.message),
  NotifyClient: (e) => log(e, e.message),
  RecordActivity: (e) => log(e, e.activity),

  // ── WF5 / WF6 ──────────────────────────────────────────────────────────────
  // The two totals WF6 computes ARE written to the fixture project, because the
  // client portal reads them: an approved change order that does not move the
  // contract total on screen would make the workflow look like it did nothing.
  RecordSelectionApproval: (e) => {
    const row = selection(e.selectionId);
    if (row !== undefined) {
      row.status = 'Approved';
      row.clientDecision = e.clientDecision;
      row.approvedDate = e.approvedDate;
    }
  },
  UpdateSelectionAmounts: (e) => {
    const row = selection(e.selectionId);
    if (row !== undefined) {
      row.upgradeAmount = e.upgradeAmount;
      row.creditAmount = e.creditAmount;
    }
  },
  UpdateRelatedTask: (e) => log(e, `${e.taskId} -> ${e.status}`),
  CreateChangeOrderFromSelection: (e) => log(e, `${e.title} (${e.addedCost})`),
  RecordChangeOrderApproval: (e) => {
    const row = changeOrder(e.changeOrderId);
    if (row !== undefined) {
      row.status = 'Approved';
      row.approvedBy = e.approvedBy;
      row.approvalDate = e.approvalDate;
    }
  },
  UpdateApprovedChangeOrders: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.approvedChangeOrders = e.total;
  },
  RecalculateProjectTotal: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.currentProjectTotal = e.currentProjectTotal;
  },
  AdjustCompletionDate: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.estimatedCompletionDate = e.revisedCompletionDate;
  },
  CreateInvoice: (e) => log(e, `${e.changeOrderId} for ${e.amount}`),
  NotifyAccounting: (e) => log(e, e.message),
  UpdatePortal: (e) => log(e, e.reason),

  // ── WF1 / WF2 — no fixture write path; they run against GHL when it exists ─
  CreateProject: (e) => log(e, e.buildsuiteProjectId),
  AssociateContact: (e) => log(e, e.contactId),
  AssociateOpportunity: (e) => log(e, e.opportunityId),
  AssignProjectManager: (e) => log(e, e.userId),
  CreateMilestone: (e) => log(e, e.milestoneName),
  CreateTask: (e) => log(e, e.taskName),
  PrepareClientPortalAccess: (e) => log(e, e.contactId),
  UpdateProjectStage: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.projectStage = e.stage;
  },
  SetProgress: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.progressPercentage = e.percentage;
  },
  SetCurrentMilestone: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.currentMilestone = e.milestoneName;
  },
  SetNextMilestone: (e) => {
    const row = project(e.buildsuiteProjectId);
    if (row !== undefined) row.nextMilestone = e.milestoneName;
  },
};
