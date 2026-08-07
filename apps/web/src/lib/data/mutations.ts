import { DAILY_UPDATES } from './fixtures';

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
