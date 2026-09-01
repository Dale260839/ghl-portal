import type {
  IssueCategory,
  ManagerApprovalStatus,
  ProjectStage,
  TaskStatus,
} from '@buildsuite/contracts';

/**
 * View models for the demo surfaces. Field names mirror ARCHITECTURE §6 — the
 * camelCase here maps 1:1 onto the display names in `project-schema.ts`, and
 * the deny-list matches on a normalized key so both spellings are caught.
 */

export interface Project {
  // ── Tenancy (D-012, D-013) ────────────────────────────────────────────────
  /**
   * BuildSuite's `auth_profiles.id` — the contractor who owns this project.
   * Every read filters on it; a project without one is visible to nobody.
   */
  ownerAuthProfileId: string;
  /** The GHL sub-account this project belongs to. Scopes every GHL read. */
  ghlLocationId: string;

  // Identity
  buildsuiteProjectId: string;
  projectName: string;
  projectAddress: string;
  projectType: string;
  clientName: string;
  primaryContactId: string;
  projectManager: string;
  superintendent: string;

  /**
   * Where this record came from, and therefore what it can be trusted to carry.
   *
   * BuildSuite holds a project's identity, client, address, dates and a budget
   * *band* — and none of the §7 stage, progress, milestones or money. A screen
   * that renders a BuildSuite-sourced project as though it had all of that shows
   * zeros and calls them facts, so the provenance travels with the row.
   */
  provenance: 'fixture' | 'buildsuite' | 'ghl';

  // Status
  /**
   * The §7 pipeline stage. **Absent on BuildSuite-sourced projects** — its
   * status vocabulary (`active`, `draft`, `matched`, ...) is its own and mapping
   * it onto the nineteen stages is lossy in both directions, so we do not.
   * Use `stageLabel()` for display rather than reading this directly.
   */
  projectStage?: ProjectStage;
  /** BuildSuite's own status word, carried verbatim when that is the source. */
  sourceStatus?: string;
  /** BuildSuite records a band, not an amount — `exact_budget` is never set. */
  budgetBand?: string;
  progressPercentage: number;
  currentMilestone: string;
  nextMilestone: string;
  clientActionRequired: boolean;
  healthStatus: 'On Track' | 'Attention Needed' | 'At Risk' | 'Delayed' | 'On Hold' | 'Completed';
  lastUpdatedDate: string;

  // Dates
  estimatedStartDate: string;
  estimatedCompletionDate: string;

  // Financials — client-visible (still gated by the switches below)
  contractAmount: number;
  approvedChangeOrders: number;
  pendingChangeOrders: number;
  currentProjectTotal: number;
  amountInvoiced: number;
  amountPaid: number;
  remainingBalance: number;
  nextPaymentAmount: number;
  nextPaymentDueDate: string;

  // §9.3 deny-list — these MUST never reach a client response
  originalEstimate: number;
  internalMarkup: number;
  margin: number;
  internalPriority: 'Low' | 'Normal' | 'High' | 'Critical';
  delayReason: string;
  internalNotes: string;

  // Visibility switches
  clientPortalEnabled: boolean;
  showBudgetToClient: boolean;
  showDetailedPricing: boolean;
  showScheduleToClient: boolean;
  showAssignedTeam: boolean;
  allowClientMessaging: boolean;
  allowIssueSubmission: boolean;
  allowFileUploads: boolean;
}

export interface Milestone {
  id: string;
  projectId: string;
  milestoneName: string;
  plannedStart: string;
  plannedEnd: string;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  sequence: number;
  clientVisible: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  taskName: string;
  assignedTrade: string;
  scheduledDate: string;
  status: TaskStatus;
  clientVisible: boolean;

  // ── Assignment (D4 §5) ────────────────────────────────────────────────────
  // "Contractor can assign tasks in the notes; the field person gets a
  // notification/ding." All three fields exist for that one sentence.

  /** Who on the crew owns it. Null means unassigned — nobody's Today screen. */
  assignedTo: string | null;
  /** The contractor's instruction. This is the "in the notes" part. */
  pmNote: string;
  /** When it was assigned. Drives ordering, so the newest ding is at the top. */
  assignedAt: string;
  /**
   * When the field user opened it. Null is the ding: unseen assignments are
   * what the badge counts, and seeing one is what clears it.
   */
  seenAt: string | null;
}

export interface DailyUpdate {
  id: string;
  projectId: string;
  updateDate: string;
  submittedBy: string;
  workCompleted: string;
  crewOnsite: number;
  hoursWorked: number;
  weather: string;

  /** §9.3 — never client-facing, under any path. */
  internalNotes: string;
  /** The only publish candidate. */
  clientSummary: string;

  clientVisible: boolean;
  managerApprovalStatus: ManagerApprovalStatus;
  publishDate: string | null;
}

/** §6.7 `Project Issue`. */
export interface Issue {
  id: string;
  projectId: string;
  /** Assigned by WF7 on creation — sequential per project. */
  issueNumber: string;
  issueTitle: string;
  category: IssueCategory;
  description: string;
  projectArea: string;
  priority: 'Normal' | 'Urgent';
  reportedBy: string;
  assignedTo: string | null;
  submittedDate: string;
  targetResolutionDate: string | null;
  status: 'Open' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed';
  /** §9.3 — never client-facing. */
  internalNotes: string;
  /** The client-safe counterpart, published deliberately. */
  clientUpdate: string;
  resolution: string;
  clientConfirmation: boolean;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  /** A contact MAY have many projects (§1.4). */
  projectIds: string[];
}

// ── Client-portal entities (Phase A, from the client demo) ──────────────────

/** §6.8 `Project Message`. Threaded, and relatable to a specific item. */
export interface Message {
  id: string;
  projectId: string;
  threadId: string;
  threadCategory: string;
  sender: string;
  senderRole: string;
  /** True when the client wrote it. */
  fromClient: boolean;
  message: string;
  sentDate: string;
  clientVisible: boolean;
  /** §6.8 relations — what "Ask Question" attaches a message to. */
  relatedTaskId?: string;
  relatedChangeOrderId?: string;
  relatedIssueId?: string;
}

/** Documents surfaced to the client. §12.3 routing decision still open. */
export interface ProjectDocument {
  id: string;
  projectId: string;
  name: string;
  category: 'Contracts' | 'Permits' | 'Plans' | 'Warranties' | 'Change Orders' | 'Other';
  uploadedDate: string;
  url: string;
  clientVisible: boolean;
}

/** Photos from the field. Sourced from daily updates and completed tasks. */
export interface ProjectPhoto {
  id: string;
  projectId: string;
  caption: string;
  url: string;
  takenDate: string;
  /** Which update or task it came from — photos are never orphaned. */
  sourceLabel: string;
  clientVisible: boolean;
}

/**
 * A scheduled appointment as the client sees it. Derived from §6.3 tasks, but
 * with the two things the demo adds: access confirmation and a location.
 */
export interface ScheduleItem {
  id: string;
  projectId: string;
  title: string;
  scheduledDate: string;
  timeWindow: string;
  crew: string;
  location: string;
  status: 'Confirmed' | 'Scheduled' | 'Tentative';
  /** Client-facing note — "please keep the driveway clear". */
  clientNote: string;
  /** PROVISIONAL (new in the demo, not in the architecture). */
  accessConfirmed: boolean;
  clientVisible: boolean;
}

/**
 * §6.5 `Material Selection`.
 *
 * `actualCost` is the internal one — §9.3 deny-list. It lives on the type
 * because the contractor's own screens need it; every client-facing read must
 * drop it, and `clientSelection()` is what does that.
 */
export interface MaterialSelection {
  id: string;
  projectId: string;
  selectionName: string;
  category: string;
  roomOrArea: string;
  manufacturer: string;
  product: string;
  colorFinish: string;
  supplier: string;
  allowance: number;
  /** §9.3 — NEVER serialized into a client response. */
  actualCost: number;
  upgradeAmount: number;
  creditAmount: number;
  leadTime: string;
  approvalDeadline: string;
  status: 'Pending' | 'Awaiting Client' | 'Approved' | 'Rejected' | 'Ordered' | 'Installed';
  clientDecision: string;
  clientComments: string;
  approvedDate: string;
  clientVisible: boolean;
}

/** §6.6 `Change Order`. */
export interface ChangeOrder {
  id: string;
  projectId: string;
  changeOrderNumber: string;
  title: string;
  description: string;
  reason: string;
  requestedBy: string;
  createdDate: string;
  addedCost: number;
  creditAmount: number;
  tax: number;
  scheduleImpactDays: number;
  revisedCompletionDate: string;
  approvalDeadline: string;
  paymentRequirement: string;
  status: 'Draft' | 'Awaiting Client' | 'Approved' | 'Rejected';
  clientComments: string;
  approvedBy: string;
  approvalDate: string;
  invoiceStatus: string;
  paymentStatus: string;
  clientVisible: boolean;
}

/**
 * A line on the client-facing budget.
 *
 * Only the §9.3 allow-list appears here: there is no cost, markup or margin
 * field on this type at all. That is the point — a value the type cannot hold
 * cannot be leaked by a screen that forgets to filter.
 */
export interface BudgetLine {
  id: string;
  projectId: string;
  category: string;
  /** Contract amount for this category. */
  contracted: number;
  /** Approved change orders attributed to it. */
  changeOrders: number;
  invoiced: number;
  paid: number;
}

/**
 * §6.9 / Artifact 90 `Punch List Item`. A closeout task — the small fixes and
 * touch-ups agreed near the end of a project — as it appears in the Hub.
 *
 * `internalNotes` is §9.3: it is dropped by construction in the client
 * projection (`ClientPunchItem` in `portal-gates.ts`), the same way `actualCost`
 * is on a `MaterialSelection`. Dates are '' when absent, matching the other
 * portal entities.
 */
export interface PunchListItem {
  id: string;
  projectId: string;
  /** Per-project sequence, e.g. "001" — the reference people say out loud. */
  itemNumber: string;
  title: string;
  location: string;
  description: string;
  status: 'Open' | 'Scheduled' | 'Completed' | 'Verified';
  reportedBy: string;
  /** True when the homeowner raised it on a walkthrough. */
  raisedByClient: boolean;
  targetDate: string;
  completedDate: string;
  /** §9.3 — NEVER serialized into a client response. */
  internalNotes: string;
  /** §9.1 — the contractor publishes deliberately. */
  clientVisible: boolean;
}

/** The statuses that count as finished work on the closeout progress bar. */
export const PUNCH_DONE_STATUSES: readonly PunchListItem['status'][] = ['Completed', 'Verified'];

/** Whether a punch item counts as finished. Takes only `status` so a client projection qualifies. */
export function punchItemDone(item: Pick<PunchListItem, 'status'>): boolean {
  return PUNCH_DONE_STATUSES.includes(item.status);
}

/**
 * Closeout progress from a punch list: total, finished, remaining, percent.
 *
 * An empty list is 100% — nothing left to close out — rather than 0% or a
 * divide-by-zero. A client at handoff with a clean list should read "done".
 */
export function punchListProgress(
  items: readonly Pick<PunchListItem, 'status'>[],
): { total: number; done: number; remaining: number; percent: number } {
  const total = items.length;
  const done = items.filter(punchItemDone).length;
  const remaining = total - done;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return { total, done, remaining, percent };
}

/**
 * What to show where a stage would go.
 *
 * A BuildSuite project has no §7 stage, so this falls back to the status
 * BuildSuite itself recorded. Never invents a mapping between the two.
 */
export function stageLabel(project: Pick<Project, 'projectStage' | 'sourceStatus'>): string {
  return project.projectStage ?? project.sourceStatus ?? 'Unknown';
}

/**
 * Whether this record carries progress, health and money — or only identity.
 *
 * BuildSuite holds who, where and when. It holds no percentage complete, no
 * health assessment and no contract value. Rendering those anyway produces
 * "0% · On Track · $0" on every row, which is not missing data — it is three
 * confident statements nobody made.
 */
export function hasOperationalDetail(project: Project): boolean {
  return project.provenance !== 'buildsuite';
}

/** Whether this record carries real money, as opposed to zeros standing in. */
export function hasFinancials(project: Project): boolean {
  return hasOperationalDetail(project);
}

/** What to show in a money column: a real amount, BuildSuite's band, or nothing. */
export function moneyLabel(project: Project, format: (n: number) => string): string {
  if (hasFinancials(project)) return format(project.currentProjectTotal);
  return project.budgetBand ?? '—';
}

/**
 * Whether a project is still live work.
 *
 * The §7 pipeline says so with a stage; BuildSuite says so with its own status
 * word. Both are checked here so callers do not have to know which source they
 * are holding — and so a BuildSuite project does not count as active merely
 * because it has no stage.
 */
export function isActiveProject(project: Project): boolean {
  if (project.projectStage !== undefined) {
    return project.projectStage !== 'Completed' && project.projectStage !== 'Canceled';
  }
  const status = project.sourceStatus ?? '';
  return status !== 'completed' && status !== 'cancelled' && status !== 'canceled';
}
