import { DAILY_UPDATES } from './fixtures';
import type { ManagerApprovalStatus } from '@buildsuite/contracts';

/**
 * In-memory state transitions for the demo, so the review → publish loop is
 * clickable rather than described. Backed by the fixture arrays, which means
 * changes live for the lifetime of the server process and reset on restart.
 *
 * The transitions themselves mirror §10 and WF4 exactly — when this is wired to
 * GHL, the effects below become the workflow's actions and the state machine in
 * `@buildsuite/contracts` stays the source of truth.
 */

function find(id: string) {
  return DAILY_UPDATES.find((u) => u.id === id);
}

function setStatus(id: string, status: ManagerApprovalStatus): void {
  const update = find(id);
  if (update === undefined) return;
  update.managerApprovalStatus = status;
}

/** WF4 — the only path that makes an update client-visible. */
export function approveAndPublish(id: string, clientSummary?: string): void {
  const update = find(id);
  if (update === undefined) return;
  if (clientSummary !== undefined) update.clientSummary = clientSummary;
  update.managerApprovalStatus = 'Approved & Published';
  update.clientVisible = true;
  update.publishDate = new Date().toISOString().slice(0, 10);
}

/** §10 — internal approval explicitly leaves Client Visible = No. */
export function approveInternally(id: string, clientSummary?: string): void {
  const update = find(id);
  if (update === undefined) return;
  if (clientSummary !== undefined) update.clientSummary = clientSummary;
  update.managerApprovalStatus = 'Approved Internally';
  update.clientVisible = false;
}

export function returnForRevision(id: string): void {
  const update = find(id);
  if (update === undefined) return;
  setStatus(id, 'Returned');
  update.clientVisible = false;
}

export function saveClientSummary(id: string, clientSummary: string): void {
  const update = find(id);
  if (update === undefined) return;
  update.clientSummary = clientSummary;
}

/** Field submission — WF3. Sets Pending and notifies the PM; never the client. */
export function submitToPm(input: {
  projectId: string;
  submittedBy: string;
  workCompleted: string;
  internalNotes: string;
  clientSummary: string;
  crewOnsite: number;
  hoursWorked: number;
  weather: string;
}): void {
  DAILY_UPDATES.unshift({
    id: `du-${DAILY_UPDATES.length + 1}-${DAILY_UPDATES.length}`,
    projectId: input.projectId,
    updateDate: new Date().toISOString().slice(0, 10),
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
}
