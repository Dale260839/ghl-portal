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
 * What to show where a stage would go.
 *
 * A BuildSuite project has no §7 stage, so this falls back to the status
 * BuildSuite itself recorded. Never invents a mapping between the two.
 */
export function stageLabel(project: Project): string {
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

/**
 * §6.6 `Change Order`. The client-facing half of a scope change.
 *
 * Field names follow §6.6 verbatim. Two notes:
 *
 * **`changeOrderNumber` is the reference people say out loud** — "we signed off
 * on change order two". It is a per-project sequence, not a global id, so it is
 * a string and it is assigned on creation, never recomputed from array order.
 *
 * **`status` is the gate.** Only `Approved` has moved money. `Pending` is
 * awaiting the client; `Question Asked` is with the contractor. Nothing here is
 * client-visible until the contractor publishes it (§9.1) — `clientVisible`
 * carries that, exactly as `ScheduleItem` does.
 *
 * PROVISIONAL: §6.6 names `Payment Requirement`, `Terms`, `Invoice Status` and
 * `Payment Status`. Those belong to the billing side (D-019 — payment routes to
 * the contractor's own Stripe through GHL), so they are deliberately absent from
 * the client projection until that flow is wired.
 */
export interface ChangeOrder {
  id: string;
  projectId: string;
  /** §6.6 Change Order Number — per-project sequence, e.g. "001". */
  changeOrderNumber: string;
  title: string;
  description: string;
  /** §6.6 Reason — why the change arose, in client-safe language. */
  reason: string;
  requestedBy: string;
  createdDate: string;
  /** §6.6 Added Cost, in dollars. Zero for a no-cost change. */
  addedCost: number;
  /** §6.6 Credit Amount — a reduction, expressed positive. */
  creditAmount: number;
  /** §6.6 Schedule Impact, in days. Zero when the date does not move. */
  scheduleImpactDays: number;
  revisedCompletionDate: string | null;
  /** §6.6 Approval Deadline — after which the PM chases it. */
  approvalDeadline: string | null;
  status: ChangeOrderStatus;
  /** What the client wrote back when asking rather than approving. */
  clientComments: string;
  approvedBy: string | null;
  approvalDate: string | null;
  /** §9.3 — never client-facing. */
  internalNotes: string;
  /** §9.1 — the contractor publishes deliberately. */
  clientVisible: boolean;
}

/**
 * §6.6 Status — the client-facing subset of Artifact 89's change-order lifecycle.
 *
 * Names are Artifact 89's verbatim (D-021 — Chris's artifacts win on naming):
 * `Client Review Pending` → `Approved` / `Rejected` / `Revision Requested`. The
 * internal-only states (Draft, Internal QA Required, Ready for Client Review,
 * Escalated…) never reach the client projection, so they are not modelled here.
 *
 * Kept as one exported list so any further rename is a single edit rather than a
 * hunt through screens.
 */
export const CHANGE_ORDER_STATUSES = [
  'Client Review Pending',
  'Approved',
  'Rejected',
  'Revision Requested',
] as const;

export type ChangeOrderStatus = (typeof CHANGE_ORDER_STATUSES)[number];

/** The only status that has moved money or the completion date. */
export const CHANGE_ORDER_APPROVED: ChangeOrderStatus = 'Approved';

/** Net effect on the contract, in dollars. Added cost less any credit. */
export function changeOrderNet(co: ChangeOrder): number {
  return co.addedCost - co.creditAmount;
}

/**
 * Rolls a project's change orders into the three figures a client needs:
 * what is already in the contract, what is still awaiting them, and the total.
 *
 * Only `Approved` counts toward `approved` — a pending change has not moved the
 * contract and must never be presented as though it has.
 */
export function changeOrderTotals(
  orders: readonly ChangeOrder[],
): { approved: number; pending: number; net: number } {
  let approved = 0;
  let pending = 0;
  for (const co of orders) {
    const net = changeOrderNet(co);
    if (co.status === CHANGE_ORDER_APPROVED) approved += net;
    else if (co.status === 'Client Review Pending') pending += net;
  }
  return { approved, pending, net: approved };
}

/**
 * Artifact 87 `Design Selection`. A material, finish, or layout the client
 * chooses from a set of options, each with a price impact over the allowance.
 *
 * The shape mirrors `ChangeOrder` on purpose — both are "a decision the client
 * makes that can move money", and keeping them parallel means the gate, the
 * publish flag and the internal-notes handling read the same on both screens.
 *
 * **`selectionNumber` is the reference people say out loud** — per-project
 * sequence assigned on creation, a string, never recomputed from array order.
 *
 * **A selection is a *choice*, not only a price.** So its options and status ride
 * the master portal switch and the per-item publish flag, and are shown to the
 * client even when pricing is hidden. Only the dollar *price impact* is gated by
 * the budget switches — see `budgetVisible` in `portal-data.ts`, which mirrors
 * the budget rule in `client-projection.ts`.
 */
export interface DesignSelection {
  id: string;
  projectId: string;
  /** Artifact 87 Selection Number — per-project sequence, e.g. "001". */
  selectionNumber: string;
  /** The trade or area this selection covers, e.g. "Countertops". Free text — Artifact 87 does not fix a category list. */
  category: string;
  title: string;
  /** Where it applies — "Main Kitchen". */
  location: string;
  description: string;
  /** The choices offered. At least one is the baseline/allowance option. */
  options: DesignOption[];
  /** Which option the client picked. Null until they choose (Awaiting). */
  selectedOptionId: string | null;
  status: DesignSelectionStatus;
  /** After which the selection blocks the schedule; the PM chases it. */
  decisionDeadline: string | null;
  /** Set when the contractor confirms the choice, not when the client submits it. */
  decidedBy: string | null;
  decidedDate: string | null;
  /** What the client wrote alongside their choice. Their words, client-facing. */
  clientComments: string;
  /** §9.3 — never client-facing. */
  internalNotes: string;
  /** §9.1 — the contractor publishes deliberately. */
  clientVisible: boolean;
}

/** One choice within a `DesignSelection`. */
export interface DesignOption {
  id: string;
  name: string;
  /** Spec/finish detail — "3x6 handmade, matte glaze". */
  detail: string;
  /**
   * Dollar impact over the allowance baseline. Zero for the baseline option
   * itself; positive for an upgrade; may be negative for a downgrade credit.
   */
  priceImpact: number;
  /** The allowance/standard option — the one included in the original scope. */
  isBaseline: boolean;
  /** '' when there is no swatch image yet. */
  imageUrl: string;
}

/**
 * Artifact 87 Selection status — the client-facing lifecycle of a choice.
 *
 * PROVISIONAL. Artifact 87 names "approval" but does not publish a verbatim
 * selection-status list the way Artifact 89 does for change orders. This is a
 * reading of the client-facing states, not a transcribed spec — flagged for
 * confirmation alongside W1–W3. Kept as one exported list so a rename is a
 * single edit rather than a hunt through screens.
 */
export const DESIGN_SELECTION_STATUSES = [
  'Awaiting Your Selection',
  'Selection Submitted',
  'Confirmed',
  'Revision Requested',
] as const;

export type DesignSelectionStatus = (typeof DESIGN_SELECTION_STATUSES)[number];

/** The only status that has committed a choice — and therefore its price impact. */
export const DESIGN_SELECTION_CONFIRMED: DesignSelectionStatus = 'Confirmed';

/** The chosen option, or null when the client has not selected one yet. */
export function selectedOption(sel: DesignSelection): DesignOption | null {
  if (sel.selectedOptionId === null) return null;
  return sel.options.find((o) => o.id === sel.selectedOptionId) ?? null;
}

/** Price impact of the chosen option over the allowance. Zero when none is chosen. */
export function selectionPriceImpact(sel: DesignSelection): number {
  const opt = selectedOption(sel);
  return opt === null ? 0 : opt.priceImpact;
}

/**
 * Rolls a project's selections into committed vs still-pending upgrade cost.
 *
 * Only `Confirmed` counts toward `confirmed` — a submitted-but-unconfirmed
 * choice has not moved anything, exactly as a pending change order has not.
 * These are upgrades *over the allowance*, a different quantity from the
 * contract total, so they are never folded into `currentProjectTotal`.
 */
export function designSelectionTotals(
  selections: readonly DesignSelection[],
): { confirmed: number; pending: number } {
  let confirmed = 0;
  let pending = 0;
  for (const sel of selections) {
    const impact = selectionPriceImpact(sel);
    if (sel.status === DESIGN_SELECTION_CONFIRMED) confirmed += impact;
    else if (sel.status === 'Selection Submitted') pending += impact;
  }
  return { confirmed, pending };
}

/**
 * Artifact 90 `Punch List Item`. A closeout task — the small fixes and touch-ups
 * agreed near the end of a project — as the client sees it.
 *
 * **`itemNumber` is the reference people say out loud**, per-project sequence,
 * a string, assigned on creation.
 *
 * **`raisedByClient` matters on this screen.** A homeowner walking the finished
 * space and flagging a scuff is the punch list working as intended; showing who
 * raised each item is what makes the client trust the list is theirs too.
 *
 * A punch item is not priced — closeout fixes are inside the contract — so this
 * screen rides only the master portal switch and the per-item publish flag, not
 * the budget switches.
 */
export interface PunchListItem {
  id: string;
  projectId: string;
  /** Artifact 90 Item Number — per-project sequence, e.g. "001". */
  itemNumber: string;
  title: string;
  /** Where the work is — "Main Kitchen". */
  location: string;
  description: string;
  status: PunchListStatus;
  /** Who flagged it — a crew member or the client. */
  reportedBy: string;
  /** True when the homeowner raised it on a walkthrough. */
  raisedByClient: boolean;
  targetDate: string | null;
  completedDate: string | null;
  /** §9.3 — never client-facing. */
  internalNotes: string;
  /** §9.1 — the contractor publishes deliberately. */
  clientVisible: boolean;
}

/**
 * Artifact 90 Punch status — the client-facing lifecycle of a closeout item.
 *
 * PROVISIONAL. Artifact 90 describes a punch list but does not publish a
 * verbatim status list; these are the standard closeout states, flagged for
 * confirmation alongside W1–W3. `Completed` and `Verified` are both "done" for
 * progress — `Verified` adds that the contractor (or client) signed it off.
 */
export const PUNCH_LIST_STATUSES = ['Open', 'Scheduled', 'Completed', 'Verified'] as const;

export type PunchListStatus = (typeof PUNCH_LIST_STATUSES)[number];

/** The statuses that count as finished work on the closeout progress bar. */
export const PUNCH_DONE_STATUSES: readonly PunchListStatus[] = ['Completed', 'Verified'];

/** Whether a punch item counts as finished. */
export function punchItemDone(item: PunchListItem): boolean {
  return PUNCH_DONE_STATUSES.includes(item.status);
}

/**
 * Rolls a project's punch list into the closeout progress a client needs:
 * how many items, how many are finished, how many remain, and a percentage.
 *
 * An empty list is 100% — there is nothing left to close out — rather than 0%
 * or a divide-by-zero. A client at handoff with a clean list should see "done",
 * not "0% complete".
 */
export function punchListProgress(
  items: readonly PunchListItem[],
): { total: number; done: number; remaining: number; percent: number } {
  const total = items.length;
  const done = items.filter(punchItemDone).length;
  const remaining = total - done;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  return { total, done, remaining, percent };
}
