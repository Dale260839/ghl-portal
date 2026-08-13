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
