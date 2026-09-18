export function pendingReviewCount(updates: { managerApprovalStatus: string }[]): number {
  return updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
}
