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

  // Status
  projectStage: ProjectStage;
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
