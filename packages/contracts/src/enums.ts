/**
 * Verbatim enums from ARCHITECTURE.md. Casing and spelling are the contract
 * (§0) — do not "clean up" these strings.
 */

/**
 * §7 — `BuildSuite™ Project Lifecycle`. 19 sequential stages.
 *
 * NOTE: the kickoff PDF says "20 stages"; the count of the canonical list in
 * §7 is 19 sequential + 2 non-linear. ARCHITECTURE.md wins (§0).
 *
 * The pipeline lives on the **Opportunity**; WF2 syncs the stage onto
 * `Project.Project Stage`.
 */
export const PROJECT_STAGES_SEQUENTIAL = [
  'New Project',
  'Estimate in Development',
  'Estimate Sent',
  'Estimate Approved',
  'Contract Sent',
  'Contract Signed',
  'Deposit Due',
  'Deposit Paid',
  'Planning',
  'Design and Selections',
  'Permitting',
  'Materials Ordered',
  'Scheduled',
  'In Progress',
  'Inspection',
  'Punch List',
  'Final Payment Due',
  'Completed',
  'Warranty',
] as const;

export const PROJECT_STAGES_NON_LINEAR = ['On Hold', 'Canceled'] as const;

export const PROJECT_STAGES = [
  ...PROJECT_STAGES_SEQUENTIAL,
  ...PROJECT_STAGES_NON_LINEAR,
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** §6.3 — Task Status. */
export const TASK_STATUSES = [
  'Not Started',
  'Scheduled',
  'In Progress',
  'Blocked',
  'Waiting on Client',
  'Waiting on Material',
  'Waiting on Inspection',
  'Ready for Review',
  'Completed',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** §6.7 — Issue Category. */
export const ISSUE_CATEGORIES = [
  'Safety Concern',
  'Damage',
  'Missing Material',
  'Incorrect Material',
  'Design Conflict',
  'Access Problem',
  'Client Request',
  'Inspection Problem',
  'Schedule Delay',
  'Equipment Problem',
  'Other',
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

/** §6.4 / §10 — `Daily Update.Manager Approval Status`. */
export const MANAGER_APPROVAL_STATUSES = [
  'Pending',
  'Returned',
  'Approved Internally',
  'Approved & Published',
] as const;

export type ManagerApprovalStatus = (typeof MANAGER_APPROVAL_STATUSES)[number];

/**
 * The ONLY approval state that satisfies the §9.1 gate.
 *
 * `Approved Internally` explicitly does not: §10 states that on internal
 * approval `Client Visible` stays No, and only WF4 (`Approved & Published`)
 * sets it to Yes and publishes the Client Summary.
 */
export const PUBLISHED_APPROVAL_STATUS: ManagerApprovalStatus = 'Approved & Published';

/** §12.1 — Field Update Review actions, verbatim. */
export const FIELD_UPDATE_REVIEW_ACTIONS = [
  'Approve and Publish',
  'Approve Internally',
  'Edit Client Summary',
  'Return for Revision',
  'Create Issue',
  'Create Task',
  'Notify Client',
] as const;

export type FieldUpdateReviewAction = (typeof FIELD_UPDATE_REVIEW_ACTIONS)[number];
