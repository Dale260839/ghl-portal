import { ownsTask } from './permissions.ts';
import type { Session } from './session.ts';

export function canChangeFieldTask(
  session: Session,
  projectIds: string[] | null,
  task: { projectId: string; assignedTo: string | null },
  status: string,
): boolean {
  return (status === 'In Progress' || status === 'Ready for Review') &&
    ownsTask(session, task) &&
    (projectIds === null || projectIds.includes(task.projectId));
}

export function pendingReviewCount(updates: { managerApprovalStatus: string }[]): number {
  return updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
}
