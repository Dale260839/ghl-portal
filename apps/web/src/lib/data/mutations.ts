import { DAILY_UPDATES, PROJECTS } from './fixtures.ts';
import type { Project } from './types.ts';

/**
 * Fixture-backed state changes that are NOT workflow effects.
 *
 * The publishing transitions used to live here. They now go through WF3 and
 * WF4 (`lib/workflows/`), applied via `fixturePorts` — so the demo's buttons
 * run the real workflows rather than a parallel code path that happens to look
 * similar. What's left here is only what a workflow doesn't own: creating the
 * draft record, and the PM editing a summary without changing state.
 *
 * Backed by the fixture arrays, so changes live for the lifetime of the server
 * process and reset on restart.
 */

function find(id: string) {
  return DAILY_UPDATES.find((u) => u.id === id);
}

/** §12.1 "Edit Client Summary" — a save with no state transition. */
export function saveClientSummary(id: string, clientSummary: string): void {
  const update = find(id);
  if (update === undefined) return;
  update.clientSummary = clientSummary;
}

/** §10 "Return for Revision" — no §11 workflow covers this transition. */
export function returnForRevision(id: string): void {
  const update = find(id);
  if (update === undefined) return;
  update.managerApprovalStatus = 'Returned';
  update.clientVisible = false;
}

/** §10 "Approve Internally" — Client Visible stays No, by definition. */
export function approveInternally(id: string, clientSummary?: string): void {
  const update = find(id);
  if (update === undefined) return;
  if (clientSummary !== undefined) update.clientSummary = clientSummary;
  update.managerApprovalStatus = 'Approved Internally';
  update.clientVisible = false;
}

/**
 * §6.1 client-visibility switches, as a named set.
 *
 * Exported so the settings screen, the server action, and the tests all work
 * from one list. A switch that exists on `Project` but is missing here would be
 * silently un-editable, which is the failure mode where a contractor thinks
 * they've hidden something and hasn't.
 */
export const VISIBILITY_SWITCHES = [
  'clientPortalEnabled',
  'showBudgetToClient',
  'showDetailedPricing',
  'showScheduleToClient',
  'showAssignedTeam',
] as const satisfies readonly (keyof Project)[];

export type VisibilitySwitch = (typeof VISIBILITY_SWITCHES)[number];

/** Display names, matching §6.1 verbatim. */
export const VISIBILITY_LABELS: Record<VisibilitySwitch, { label: string; help: string }> = {
  clientPortalEnabled: {
    label: 'Client Portal Enabled',
    help: 'Master switch. Off means the client sees nothing at all, whatever else is set.',
  },
  showBudgetToClient: {
    label: 'Show Budget to Client',
    help: 'Contract amount, change orders, invoiced, paid, remaining balance.',
  },
  showDetailedPricing: {
    label: 'Show Detailed Pricing',
    help: 'Line-level pricing. Never includes your cost, markup, or margin.',
  },
  showScheduleToClient: {
    label: 'Show Schedule to Client',
    help: 'Milestone dates and the estimated completion date.',
  },
  showAssignedTeam: {
    label: 'Show Assigned Team',
    help: 'Project manager and superintendent names.',
  },
};

/**
 * Applies visibility switches to a project.
 *
 * Takes the full set every time rather than a partial patch: an HTML form omits
 * unchecked boxes entirely, so a patch-shaped API would make "unchecked" and
 * "not submitted" indistinguishable — and the safe reading of that ambiguity
 * (leave it as it was) is exactly wrong when someone is trying to turn something
 * off.
 */
export function setVisibility(
  buildsuiteProjectId: string,
  switches: Record<VisibilitySwitch, boolean>,
): void {
  const project = PROJECTS.find((p) => p.buildsuiteProjectId === buildsuiteProjectId);
  if (project === undefined) return;
  for (const key of VISIBILITY_SWITCHES) {
    project[key] = switches[key];
  }
}

export interface DraftUpdateInput {
  projectId: string;
  submittedBy: string;
  workCompleted: string;
  internalNotes: string;
  clientSummary: string;
  crewOnsite: number;
  hoursWorked: number;
  weather: string;
}

/**
 * Creates the draft record and returns its id. Deliberately does NOT set an
 * approval status — WF3 owns that, and having two places that decide "a new
 * submission is Pending" is how the two drift apart.
 */
export function createDraftUpdate(input: DraftUpdateInput, today: string): string {
  const id = `du-${DAILY_UPDATES.length + 1}-${Date.now().toString(36)}`;
  DAILY_UPDATES.unshift({
    id,
    projectId: input.projectId,
    updateDate: today,
    submittedBy: input.submittedBy,
    workCompleted: input.workCompleted,
    crewOnsite: input.crewOnsite,
    hoursWorked: input.hoursWorked,
    weather: input.weather,
    internalNotes: input.internalNotes,
    clientSummary: input.clientSummary,
    clientVisible: false,
    managerApprovalStatus: 'Pending',
    publishDate: null,
  });
  return id;
}
