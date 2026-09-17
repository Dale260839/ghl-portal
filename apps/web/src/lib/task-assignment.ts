import { TASK_STATUSES, type TaskStatus } from '@buildsuite/contracts';

/**
 * A contractor assigning a task to someone on the crew (John, 2026-09-17).
 *
 * "How does the contractor assign tasks to the field crew? If that doesn't
 * exist, make sure contractors can assign tasks to crews."
 *
 * It did not exist. `hub_tasks` has carried `assigned_to` (a crew membership),
 * `pm_note`, `assigned_at` and `seen_at` since migration 0001, the store could
 * create an assigned task, and the crew's Tasks screen already shows what is
 * assigned to them with a "new" badge — but no screen or action ever created
 * one, so every crew member's Tasks screen was permanently empty.
 *
 * ---------------------------------------------------------------------------
 * THE RULES
 *
 *   · Only field crew on THIS project can be assigned, and nobody revoked —
 *     the same list People shows. A posted id outside it is refused, so a form
 *     cannot hand work (or a notification) to another contractor's crew.
 *   · Assigning, or reassigning to someone else, is a new "ding": `assigned_at`
 *     is now and `seen_at` is cleared, so it shows as new on their screen.
 *   · Saving a task without changing who it is assigned to leaves the ding
 *     alone. Fixing a typo in the note must not un-read it for the crew.
 * ---------------------------------------------------------------------------
 *
 * Pure: tested without a request or a database.
 */

export interface CrewMember {
  id: string;
  email: string;
  fullName: string;
  role: string;
  revoked: boolean;
}

export interface CrewOption {
  id: string;
  label: string;
}

/** Who a task on this project can be given to. */
export function assignableCrew(crew: readonly CrewMember[]): CrewOption[] {
  return crew
    .filter((m) => m.role === 'field' && !m.revoked)
    .map((m) => ({ id: m.id, label: m.fullName.trim() === '' ? m.email.trim() : m.fullName.trim() }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Posted by the edit form when the task is with someone who is no longer
 * offered (removed from the project, or revoked). Saving a note change must
 * neither refuse nor quietly unassign them.
 */
export const KEEP_ASSIGNEE = 'keep';

export type TaskAssignee =
  | { readonly kind: 'unassigned' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'crew'; readonly member: CrewOption }
  | { readonly kind: 'unknown' };

/** What a posted "assign to" value means. Anything not offered is refused. */
export function resolveTaskAssignee(options: readonly CrewOption[], posted: string): TaskAssignee {
  const id = posted.trim();
  if (id === '') return { kind: 'unassigned' };
  if (id === KEEP_ASSIGNEE) return { kind: 'keep' };
  const member = options.find((o) => o.id === id);
  return member === undefined ? { kind: 'unknown' } : { kind: 'crew', member };
}

export interface AssignmentPatch {
  assignedTo: string | null;
  assignedAt: string | null;
}

/**
 * The assignment columns to write, or null when who it is assigned to did not
 * change — in which case `assigned_at` and `seen_at` must be left exactly as
 * they are.
 */
export function assignmentChange(
  previous: string | null,
  next: TaskAssignee,
  now: string,
): AssignmentPatch | null {
  if (next.kind === 'unknown' || next.kind === 'keep') return null;
  const nextId = next.kind === 'crew' ? next.member.id : null;
  if (nextId === previous) return null;
  return { assignedTo: nextId, assignedAt: nextId === null ? null : now };
}

/** How the contractor sees who a task is with. */
export function assigneeLabel(team: readonly CrewMember[], assignedTo: string | null): string {
  if (assignedTo === null) return 'Unassigned';
  const member = team.find((m) => m.id === assignedTo);
  if (member === undefined) return 'Someone no longer on this project';
  const name = member.fullName.trim() === '' ? member.email.trim() : member.fullName.trim();
  return member.revoked ? `${name} (access revoked)` : name;
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
