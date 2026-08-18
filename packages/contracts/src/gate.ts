/**
 * §9.1 — "the gate". The single rule governing every client-facing read.
 *
 *   client_can_see(record) ==
 *       record.Client Visible == Yes
 *       AND record.Manager Approval == Approved            (where applicable)
 *       AND Project.Client Portal Enabled == true
 *       AND requesting_contact is associated with record.Project
 *
 * Enforced at the data layer. Every client-facing query MUST filter by the
 * signed-in contact's associated project(s) — no cross-project leakage.
 */

import { PUBLISHED_APPROVAL_STATUS, type ManagerApprovalStatus } from './enums.ts';

export interface GateRecord {
  /** `Client Visible` (§6). Absent/false → internal-only. */
  clientVisible: boolean;
  /**
   * `Manager Approval Status` (§6.4). `null` means the record type has no
   * approval step — the "(where applicable)" clause of §9.1. Only
   * `Approved & Published` satisfies the gate; `Approved Internally` does not
   * (§10 keeps Client Visible = No at that state).
   */
  managerApprovalStatus: ManagerApprovalStatus | null;
  /** `BuildSuite Project ID` of the project this record hangs off (§5). */
  projectId: string;
}

export interface GateProject {
  /** `Client Portal Enabled` (§6.1) — the per-project master switch. */
  clientPortalEnabled: boolean;
}

export interface GateRequester {
  /**
   * Project IDs the signed-in contact is associated with. A contact MAY have
   * many projects (§1.4) — never collapse this to a single ID.
   */
  associatedProjectIds: readonly string[];
}

export type GateDenialReason =
  | 'client_visible_false'
  | 'manager_approval_not_published'
  | 'client_portal_disabled'
  | 'contact_not_associated';

export type GateResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: GateDenialReason };

/**
 * Returns the first failing clause rather than a bare boolean, so a denial is
 * debuggable in logs without logging the record itself.
 */
export function evaluateGate(
  record: GateRecord,
  project: GateProject,
  requester: GateRequester,
): GateResult {
  if (record.clientVisible !== true) {
    return { allowed: false, reason: 'client_visible_false' };
  }
  if (
    record.managerApprovalStatus !== null &&
    record.managerApprovalStatus !== PUBLISHED_APPROVAL_STATUS
  ) {
    return { allowed: false, reason: 'manager_approval_not_published' };
  }
  if (project.clientPortalEnabled !== true) {
    return { allowed: false, reason: 'client_portal_disabled' };
  }
  if (!requester.associatedProjectIds.includes(record.projectId)) {
    return { allowed: false, reason: 'contact_not_associated' };
  }
  return { allowed: true };
}

export function clientCanSee(
  record: GateRecord,
  project: GateProject,
  requester: GateRequester,
): boolean {
  return evaluateGate(record, project, requester).allowed;
}

/** Convenience for list endpoints. Filtering, never post-hoc UI hiding. */
export function filterForClient<T extends GateRecord>(
  records: readonly T[],
  project: GateProject,
  requester: GateRequester,
): T[] {
  return records.filter((record) => clientCanSee(record, project, requester));
}

/**
 * §9.2 — authentication tiers. Email + Project ID is a lookup convenience only
 * (§3.4); it MUST NOT gate anything in `PORTAL_LOGIN_REQUIRED`.
 */
export const PORTAL_LOGIN_REQUIRED = [
  'approvals',
  'payments',
  'documents',
  'private_messages',
  'warranty',
] as const;

export type ProtectedActionClass = (typeof PORTAL_LOGIN_REQUIRED)[number];

export type AuthTier = 'email_and_project_id' | 'portal_login';

export function isActionAllowed(action: ProtectedActionClass, tier: AuthTier): boolean {
  return tier === 'portal_login';
}
