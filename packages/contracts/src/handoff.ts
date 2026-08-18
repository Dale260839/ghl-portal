/**
 * §8.2 — the BuildSuite → GHL handoff payload, written onto the Contact by the
 * `Send to CRM` action. Field names below are the contract with Sing's
 * extension; they are snake_case exactly as specified in §8.2, not the
 * display-cased §6 field names.
 *
 * WF1 (New Project Setup) reads these and creates the `Project` record. No
 * other operational data is expected from BuildSuite (§1.2).
 */

import { assertProjectId, isProjectIdOrFixture } from './ids.ts';

export interface HandoffClient {
  name: string;
  email: string;
  phone: string;
}

export interface HandoffPayload {
  /** Required, unique, immutable (§5). */
  buildsuite_project_id: string;
  project_name: string;
  project_address: string;
  /** Currency. */
  contract_amount: number;
  /** Creates/updates the Contact. */
  client: HandoffClient;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * Collects every problem rather than throwing on the first. The handoff fires
 * once per signed proposal; a partial error report would mean a second failed
 * round-trip for the same payload.
 */
export function validateHandoffPayload(payload: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (payload === null || typeof payload !== 'object') {
    return [{ field: '$', message: 'payload must be an object' }];
  }
  const p = payload as Partial<HandoffPayload>;

  if (!isProjectIdOrFixture(p.buildsuite_project_id)) {
    issues.push({
      field: 'buildsuite_project_id',
      message: 'required; must match BSP-YYYY-NNNNNN (§5)',
    });
  }
  for (const field of ['project_name', 'project_address'] as const) {
    if (typeof p[field] !== 'string' || p[field]!.trim() === '') {
      issues.push({ field, message: 'required non-empty string' });
    }
  }
  if (typeof p.contract_amount !== 'number' || !Number.isFinite(p.contract_amount)) {
    issues.push({ field: 'contract_amount', message: 'required finite number (currency)' });
  }
  if (p.client === null || typeof p.client !== 'object') {
    issues.push({ field: 'client', message: 'required object { name, email, phone }' });
  } else {
    for (const field of ['name', 'email', 'phone'] as const) {
      if (typeof p.client[field] !== 'string' || p.client[field]!.trim() === '') {
        issues.push({ field: `client.${field}`, message: 'required non-empty string' });
      }
    }
  }
  return issues;
}

export function assertHandoffPayload(payload: unknown): HandoffPayload {
  const issues = validateHandoffPayload(payload);
  if (issues.length > 0) {
    throw new TypeError(
      `invalid handoff payload (§8.2): ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
    );
  }
  const p = payload as HandoffPayload;
  assertProjectId(p.buildsuite_project_id, 'buildsuite_project_id');
  return p;
}
