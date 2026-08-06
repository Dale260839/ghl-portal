import type { ProjectStage } from '@buildsuite/contracts';

/**
 * ⚠️ PROVISIONAL — three things §11 requires but never specifies.
 *
 * ARCHITECTURE §0: "Do not silently invent schema, field names, workflow
 * behavior... if something needed is not defined here, treat it as an open
 * decision and ask." These three are exactly that. They are isolated here,
 * marked, and raised in KICKOFF.md §5 rather than scattered through the
 * workflow logic where a guess would look like a specification.
 *
 *   1. WF2 must "update Progress Percentage" on stage change — no mapping given.
 *   2. WF1 must "create default milestones / default tasks" — no list given.
 *   3. WF2 must "notify client only when appropriate" — "appropriate" undefined.
 *
 * All three are one-table edits once Chris confirms. None block building the
 * workflows, because the logic reads from these tables rather than hard-coding.
 */

/**
 * Stage → Progress Percentage. PROVISIONAL.
 *
 * Anchored on the two figures the architecture DOES give: WF1 sets 10% on
 * project creation (§11) and WF8 sets 100% at Completed (§11). Everything
 * between is a straight-line estimate across the 19 sequential stages.
 */
export const STAGE_PROGRESS: Record<ProjectStage, number> = {
  'New Project': 5,
  'Estimate in Development': 8,
  'Estimate Sent': 10,
  'Estimate Approved': 10,
  'Contract Sent': 12,
  'Contract Signed': 15,
  'Deposit Due': 18,
  'Deposit Paid': 20,
  Planning: 25,
  'Design and Selections': 32,
  Permitting: 38,
  'Materials Ordered': 45,
  Scheduled: 50,
  'In Progress': 65,
  Inspection: 80,
  'Punch List': 90,
  'Final Payment Due': 95,
  Completed: 100,
  Warranty: 100,
  // Non-linear stages must not move the number — a project going On Hold at 65%
  // has not regressed to 0, and showing that to a client would be alarming and
  // wrong. The planner skips the progress effect entirely for these.
  'On Hold': -1,
  Canceled: -1,
};

export function progressForStage(stage: ProjectStage): number | null {
  const value = STAGE_PROGRESS[stage];
  return value < 0 ? null : value;
}

/** WF1 default milestones. PROVISIONAL — no list given in §11. */
export const DEFAULT_MILESTONES: readonly string[] = [
  'Planning and Design',
  'Permitting',
  'Material Procurement',
  'Construction',
  'Inspection',
  'Punch List',
  'Final Walkthrough',
];

/** WF1 default tasks. PROVISIONAL. Kept minimal deliberately — a wrong default
 *  task on every new project is noise a PM has to clear by hand. */
export const DEFAULT_TASKS: readonly { taskName: string; assignedTrade: string }[] = [
  { taskName: 'Confirm project scope with client', assignedTrade: 'General' },
  { taskName: 'Schedule pre-construction walkthrough', assignedTrade: 'General' },
];

/**
 * Stages where a stage change warrants notifying the client. PROVISIONAL.
 *
 * Biased toward silence. §11 says "notify client only when appropriate", and
 * over-notifying is the failure mode that gets a portal muted — after which the
 * notifications that matter are missed too. These are the stages a homeowner
 * would want a message about; the rest are visible in the portal when they look.
 */
export const CLIENT_NOTIFY_STAGES: readonly ProjectStage[] = [
  'Contract Signed',
  'Scheduled',
  'In Progress',
  'Punch List',
  'Final Payment Due',
  'Completed',
];

export function shouldNotifyClientOnStage(stage: ProjectStage): boolean {
  return CLIENT_NOTIFY_STAGES.includes(stage);
}

/** Progress at project creation. This one IS specified — §11, WF1. */
export const INITIAL_PROGRESS = 10;
