import { assertNoInternalFields, evaluateGate, type GateDenialReason } from '@buildsuite/contracts';
import type { Contact, DailyUpdate, Milestone, Project } from './data/types';

/**
 * The §9.1 gate and the §9.3 allow-list projection — pure, no runtime imports.
 *
 * Split out of `client-view.ts` so it can be unit-tested directly. That file
 * still owns the `server-only` guard; this one owns the logic. The security
 * rules are the thing most worth having tests on, and a module that can only be
 * imported inside a React Server Component is a module that never gets them.
 *
 * Two layers on purpose:
 *   1. An explicit ALLOW-LIST — the client DTO is built field by field, so a new
 *      internal field on `Project` cannot reach a client by default. Deny-lists
 *      fail open; allow-lists fail closed.
 *   2. `assertNoInternalFields` as a backstop, which throws if a §9.3 field
 *      somehow made it into the payload anyway.
 */

export interface ClientProjectView {
  buildsuiteProjectId: string;
  projectName: string;
  projectAddress: string;
  projectStage: string;
  progressPercentage: number;
  currentMilestone: string;
  nextMilestone: string;
  clientActionRequired: boolean;
  lastUpdatedDate: string;
  estimatedCompletionDate: string | null;
  team: { projectManager: string; superintendent: string } | null;
  budget: {
    contractAmount: number;
    approvedChangeOrders: number;
    pendingChangeOrders: number;
    currentProjectTotal: number;
    amountInvoiced: number;
    amountPaid: number;
    remainingBalance: number;
    nextPaymentAmount: number;
    nextPaymentDueDate: string;
  } | null;
}

export interface ClientUpdateView {
  id: string;
  updateDate: string;
  clientSummary: string;
  publishDate: string | null;
}

export interface ClientMilestoneView {
  id: string;
  milestoneName: string;
  plannedStart: string;
  plannedEnd: string;
  status: string;
}

export type ProjectProjection =
  | { allowed: true; view: ClientProjectView }
  | { allowed: false; reason: GateDenialReason };

export function toClientProject(project: Project, requester: Contact): ProjectProjection {
  const gate = evaluateGate(
    {
      // A Project record has no approval step of its own — the "(where
      // applicable)" clause of §9.1.
      clientVisible: true,
      managerApprovalStatus: null,
      projectId: project.buildsuiteProjectId,
    },
    { clientPortalEnabled: project.clientPortalEnabled },
    { associatedProjectIds: requester.projectIds },
  );

  if (!gate.allowed) {
    return { allowed: false, reason: gate.reason };
  }

  const view: ClientProjectView = {
    buildsuiteProjectId: project.buildsuiteProjectId,
    projectName: project.projectName,
    projectAddress: project.projectAddress,
    projectStage: project.projectStage,
    progressPercentage: project.progressPercentage,
    currentMilestone: project.currentMilestone,
    nextMilestone: project.nextMilestone,
    clientActionRequired: project.clientActionRequired,
    lastUpdatedDate: project.lastUpdatedDate,

    // §6.1 — gated by `Show Schedule to Client`.
    estimatedCompletionDate: project.showScheduleToClient ? project.estimatedCompletionDate : null,

    // §6.1 — PM and Superintendent names only when `Show Assigned Team` is on.
    team: project.showAssignedTeam
      ? { projectManager: project.projectManager, superintendent: project.superintendent }
      : null,

    // §9.3 — the client-visible financial allow-list, gated by the budget
    // switches. Original Estimate, Markup, and Margin are absent by
    // construction: they are simply never read here.
    budget:
      project.showBudgetToClient || project.showDetailedPricing
        ? {
            contractAmount: project.contractAmount,
            approvedChangeOrders: project.approvedChangeOrders,
            pendingChangeOrders: project.pendingChangeOrders,
            currentProjectTotal: project.currentProjectTotal,
            amountInvoiced: project.amountInvoiced,
            amountPaid: project.amountPaid,
            remainingBalance: project.remainingBalance,
            nextPaymentAmount: project.nextPaymentAmount,
            nextPaymentDueDate: project.nextPaymentDueDate,
          }
        : null,
  };

  assertNoInternalFields(view, `client project view ${project.buildsuiteProjectId}`);
  return { allowed: true, view };
}

/**
 * §10 — only `Approved & Published` updates reach a client, and only the
 * `Client Summary` is published. `Internal Notes` is never read here at all.
 */
export function toClientUpdates(updates: DailyUpdate[], project: Project): ClientUpdateView[] {
  const views = updates
    .filter(
      (u) =>
        evaluateGate(
          {
            clientVisible: u.clientVisible,
            managerApprovalStatus: u.managerApprovalStatus,
            projectId: u.projectId,
          },
          { clientPortalEnabled: project.clientPortalEnabled },
          { associatedProjectIds: [project.buildsuiteProjectId] },
        ).allowed,
    )
    .map((u) => ({
      id: u.id,
      updateDate: u.updateDate,
      clientSummary: u.clientSummary,
      publishDate: u.publishDate,
    }));

  assertNoInternalFields(views, 'client update feed');
  return views;
}

export function toClientMilestones(
  milestones: Milestone[],
  project: Project,
): ClientMilestoneView[] {
  if (!project.showScheduleToClient) return [];
  return milestones
    .filter((m) => m.clientVisible)
    .map((m) => ({
      id: m.id,
      milestoneName: m.milestoneName,
      plannedStart: m.plannedStart,
      plannedEnd: m.plannedEnd,
      status: m.status,
    }));
}
