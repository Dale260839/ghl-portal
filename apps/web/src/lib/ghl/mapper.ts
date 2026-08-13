import type { ProjectStage } from '@buildsuite/contracts';
import { PROJECT_STAGES } from '@buildsuite/contracts';
import type { Project } from '../data/types';

/**
 * ⚠️ PROVISIONAL — this is the one file that needs correcting when real JSON
 * arrives from Phase 0.
 *
 * Everything else in `ghl/` is shape-agnostic: the transport handles auth,
 * retries, and errors without knowing what a project looks like. The response
 * shape is quarantined here on purpose, so "we guessed the JSON wrong" is a
 * one-file fix rather than a rewrite.
 *
 * What is assumed, and needs confirming against a real response:
 *   - a record's custom fields live under `properties`, keyed by field key
 *   - field keys are snake_case versions of the §6.1 display names
 *   - list responses are `{ records: [...] }`
 *
 * `docs/PHASE-0.md` §3 asks Chris and Pat to paste the raw response. Once it
 * lands, fix FIELD_KEYS and `readProperties` and the rest stays as-is.
 */

/** §6.1 display name → assumed GHL field key. Correct these against real data. */
export const FIELD_KEYS = {
  buildsuiteProjectId: 'buildsuite_project_id',
  projectName: 'project_name',
  projectAddress: 'project_address',
  projectType: 'project_type',
  clientName: 'client_name',
  projectManager: 'project_manager',
  superintendent: 'superintendent',
  projectStage: 'project_stage',
  progressPercentage: 'progress_percentage',
  currentMilestone: 'current_milestone',
  nextMilestone: 'next_milestone',
  clientActionRequired: 'client_action_required',
  healthStatus: 'health_status',
  lastUpdatedDate: 'last_updated_date',
  estimatedStartDate: 'estimated_start_date',
  estimatedCompletionDate: 'estimated_completion_date',
  contractAmount: 'contract_amount',
  approvedChangeOrders: 'approved_change_orders',
  pendingChangeOrders: 'pending_change_orders',
  currentProjectTotal: 'current_project_total',
  amountInvoiced: 'amount_invoiced',
  amountPaid: 'amount_paid',
  remainingBalance: 'remaining_balance',
  nextPaymentAmount: 'next_payment_amount',
  nextPaymentDueDate: 'next_payment_due_date',
  originalEstimate: 'original_estimate',
  internalMarkup: 'internal_markup',
  margin: 'margin',
  internalPriority: 'internal_priority',
  delayReason: 'delay_reason',
  internalNotes: 'internal_notes',
  clientPortalEnabled: 'client_portal_enabled',
  showBudgetToClient: 'show_budget_to_client',
  showDetailedPricing: 'show_detailed_pricing',
  showScheduleToClient: 'show_schedule_to_client',
  showAssignedTeam: 'show_assigned_team',
} as const;

export interface GhlRecord {
  id?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Reads a field, tolerating whether it sits under `properties` or at the root. */
function read(record: GhlRecord, key: string): unknown {
  const properties = record.properties;
  if (properties !== undefined && key in properties) return properties[key];
  return record[key];
}

function str(record: GhlRecord, key: string, fallback = ''): string {
  const value = read(record, key);
  return typeof value === 'string' ? value : value === undefined || value === null ? fallback : String(value);
}

function num(record: GhlRecord, key: string, fallback = 0): number {
  const value = read(record, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * GHL checkboxes come back as any of `true`, `"true"`, `"yes"`, `1`, `"1"`
 * depending on how the field was created. Defaulting to **false** matters:
 * `clientPortalEnabled` is a clause of the §9.1 gate, so an unparseable value
 * must close the gate, never open it.
 */
function bool(record: GhlRecord, key: string): boolean {
  const value = read(record, key);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1';
  }
  return false;
}

function stage(record: GhlRecord): ProjectStage {
  const value = str(record, FIELD_KEYS.projectStage);
  const match = PROJECT_STAGES.find((s) => s === value);
  // An unrecognised stage means the pipeline drifted from §7. Falling back to
  // 'New Project' keeps the screen rendering; the mismatch shows up in the UI
  // rather than as a crash.
  return match ?? 'New Project';
}

export function mapProject(record: GhlRecord): Project {
  return {
    // Tenancy (D-012, D-013). Blank means the record is owned by nobody and is
    // therefore visible to nobody — the correct fail-closed default.
    ownerAuthProfileId: str(record, 'auth_profile_id'),
    ghlLocationId: str(record, 'location_id'),
    buildsuiteProjectId: str(record, FIELD_KEYS.buildsuiteProjectId),
    projectName: str(record, FIELD_KEYS.projectName),
    projectAddress: str(record, FIELD_KEYS.projectAddress),
    projectType: str(record, FIELD_KEYS.projectType),
    clientName: str(record, FIELD_KEYS.clientName),
    primaryContactId: str(record, 'primary_contact_id'),
    projectManager: str(record, FIELD_KEYS.projectManager),
    superintendent: str(record, FIELD_KEYS.superintendent),

    projectStage: stage(record),
    progressPercentage: num(record, FIELD_KEYS.progressPercentage),
    currentMilestone: str(record, FIELD_KEYS.currentMilestone),
    nextMilestone: str(record, FIELD_KEYS.nextMilestone),
    clientActionRequired: bool(record, FIELD_KEYS.clientActionRequired),
    healthStatus: (str(record, FIELD_KEYS.healthStatus, 'On Track') as Project['healthStatus']),
    lastUpdatedDate: str(record, FIELD_KEYS.lastUpdatedDate),

    estimatedStartDate: str(record, FIELD_KEYS.estimatedStartDate),
    estimatedCompletionDate: str(record, FIELD_KEYS.estimatedCompletionDate),

    contractAmount: num(record, FIELD_KEYS.contractAmount),
    approvedChangeOrders: num(record, FIELD_KEYS.approvedChangeOrders),
    pendingChangeOrders: num(record, FIELD_KEYS.pendingChangeOrders),
    currentProjectTotal: num(record, FIELD_KEYS.currentProjectTotal),
    amountInvoiced: num(record, FIELD_KEYS.amountInvoiced),
    amountPaid: num(record, FIELD_KEYS.amountPaid),
    remainingBalance: num(record, FIELD_KEYS.remainingBalance),
    nextPaymentAmount: num(record, FIELD_KEYS.nextPaymentAmount),
    nextPaymentDueDate: str(record, FIELD_KEYS.nextPaymentDueDate),

    originalEstimate: num(record, FIELD_KEYS.originalEstimate),
    internalMarkup: num(record, FIELD_KEYS.internalMarkup),
    margin: num(record, FIELD_KEYS.margin),
    internalPriority: (str(record, FIELD_KEYS.internalPriority, 'Normal') as Project['internalPriority']),
    delayReason: str(record, FIELD_KEYS.delayReason),
    internalNotes: str(record, FIELD_KEYS.internalNotes),

    clientPortalEnabled: bool(record, FIELD_KEYS.clientPortalEnabled),
    showBudgetToClient: bool(record, FIELD_KEYS.showBudgetToClient),
    showDetailedPricing: bool(record, FIELD_KEYS.showDetailedPricing),
    showScheduleToClient: bool(record, FIELD_KEYS.showScheduleToClient),
    showAssignedTeam: bool(record, FIELD_KEYS.showAssignedTeam),
  };
}
