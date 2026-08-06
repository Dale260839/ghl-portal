import { PROJECT_STAGES, type ProjectStage } from '@buildsuite/contracts';
import { progressForStage, shouldNotifyClientOnStage } from './defaults.ts';
import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF2 — Project Stage Sync (§11).
 *
 * Trigger: the Opportunity's pipeline stage changes. The pipeline lives on the
 * Opportunity (§7); this mirrors it onto `Project.Project Stage`.
 *
 * Actions, verbatim from §11: find associated Project · update Project Stage ·
 * update Progress Percentage · set Current Milestone · set Next Milestone ·
 * notify assigned team · notify client **only when appropriate**.
 */

export interface Wf2Trigger {
  /** §3.6 — the association is by shared key, never by name or title. */
  buildsuiteProjectId: string | null;
  fromStage: ProjectStage | null;
  toStage: string;
  contactId: string | null;
  projectName: string;
  /** Milestones already on the project, in sequence order. */
  milestones: readonly { milestoneName: string; sequence: number }[];
}

export const WF2 = 'WF2 Project Stage Sync';

/**
 * Maps a lifecycle stage onto the project's own milestone list. Falls back to
 * the stage name when no milestone matches, which is honest: the project's
 * milestones are contractor-defined and may not line up with the pipeline.
 */
function milestonesFor(
  trigger: Wf2Trigger,
  stage: ProjectStage,
): { current: string; next: string | null } {
  const ordered = [...trigger.milestones].sort((a, b) => a.sequence - b.sequence);
  const index = ordered.findIndex(
    (m) => m.milestoneName.toLowerCase() === stage.toLowerCase(),
  );

  if (index === -1) {
    return { current: stage, next: ordered[0]?.milestoneName ?? null };
  }
  return {
    current: ordered[index]!.milestoneName,
    next: ordered[index + 1]?.milestoneName ?? null,
  };
}

export function planStageSync(trigger: Wf2Trigger): WorkflowPlan {
  if (trigger.buildsuiteProjectId === null || trigger.buildsuiteProjectId === '') {
    // §11's first action is "find associated Project". No shared key means no
    // association — and §3.6 forbids falling back to matching on name or
    // opportunity title, which is exactly what a helpful guess would do here.
    return {
      ran: false,
      workflow: WF2,
      skipped: 'opportunity has no BuildSuite Project ID — cannot associate a project (§3.6)',
    };
  }

  const stage = PROJECT_STAGES.find((s) => s === trigger.toStage);
  if (stage === undefined) {
    return {
      ran: false,
      workflow: WF2,
      skipped: `"${trigger.toStage}" is not a stage in the BuildSuite™ Project Lifecycle (§7)`,
    };
  }

  if (trigger.fromStage === stage) {
    // Stage-change webhooks re-fire. Doing the work twice would re-notify the
    // client for a stage they were already told about.
    return { ran: false, workflow: WF2, skipped: `already at ${stage}` };
  }

  const id = trigger.buildsuiteProjectId;
  const effects: Effect[] = [{ type: 'UpdateProjectStage', buildsuiteProjectId: id, stage }];

  // On Hold / Canceled return null — a paused project has not regressed to 0%.
  const progress = progressForStage(stage);
  if (progress !== null) {
    effects.push({ type: 'SetProgress', buildsuiteProjectId: id, percentage: progress });
  }

  const { current, next } = milestonesFor(trigger, stage);
  effects.push({ type: 'SetCurrentMilestone', buildsuiteProjectId: id, milestoneName: current });
  if (next !== null) {
    effects.push({ type: 'SetNextMilestone', buildsuiteProjectId: id, milestoneName: next });
  }

  effects.push({
    type: 'NotifyTeam',
    buildsuiteProjectId: id,
    message: `${trigger.projectName} moved to ${stage}`,
  });

  // §11 — "notify client only when appropriate". See CLIENT_NOTIFY_STAGES;
  // the list is provisional and biased toward silence.
  if (shouldNotifyClientOnStage(stage) && trigger.contactId !== null) {
    effects.push({
      type: 'NotifyClient',
      buildsuiteProjectId: id,
      contactId: trigger.contactId,
      message: `Your project has moved to ${stage}.`,
    });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Stage ${trigger.fromStage ?? '—'} → ${stage}`,
  });

  return { ran: true, workflow: WF2, effects };
}
