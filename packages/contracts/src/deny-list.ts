/**
 * §9.3 — fields that are NEVER serialized into any client-facing response.
 *
 * This is enforced at the data layer, not the UI (§3.5, §13). The UI must never
 * be the only enforcement, so every client-facing serializer runs through
 * `stripInternalFields` and every client-facing response test runs through
 * `assertNoInternalFields`.
 */

import { normalizeFieldName } from './field-names.ts';

/** Verbatim §9.3, including the slash-separated variants as distinct entries. */
export const INTERNAL_FIELD_DENY_LIST = [
  'Internal Notes',
  'Vendor Cost',
  'Internal Labor Cost',
  'Labor Cost',
  'Estimated Cost',
  'Original Estimate',
  'Markup',
  'Internal Markup',
  'Margin',
  'Profit',
  'Contingency',
  'Private Team Messages',
  'Internal Risk Assessment',
  'Delay Reason',
  'Internal Priority',
] as const;

/**
 * §9.3 — client-visible financial fields. Passing this list is necessary but
 * NOT sufficient: these are still gated by the per-project `Show Budget to
 * Client` / `Show Detailed Pricing` switches (§6.1) and by the §9.1 gate.
 */
export const CLIENT_VISIBLE_FINANCIAL_FIELDS = [
  'Contract Amount',
  'Contract Price',
  'Allowance',
  'Upgrade',
  'Upgrade Amount',
  'Credit',
  'Credit Amount',
  'Approved Change Orders',
  'Pending Change Orders',
  'Invoice Amount',
  'Amount Invoiced',
  'Amount Paid',
  'Remaining Balance',
  'Next Payment Amount',
  'Next Payment Due Date',
] as const;

const DENIED = new Set(INTERNAL_FIELD_DENY_LIST.map(normalizeFieldName));

/**
 * True if a field name is on the deny-list, matched on a normalized key so
 * that `Internal Notes`, `internal_notes`, and `internalNotes` all resolve to
 * the same field.
 */
export function isInternalField(fieldName: string): boolean {
  return DENIED.has(normalizeFieldName(fieldName));
}

/**
 * Recursively removes every deny-listed field from a payload. Runs over arrays
 * and nested objects because internal fields hide on associated records
 * (a Daily Update's `Internal Notes`, a Selection's `Actual Cost`) at least as
 * often as on the Project itself.
 */
export function stripInternalFields<T>(payload: T): T {
  if (Array.isArray(payload)) {
    return payload.map((item) => stripInternalFields(item)) as unknown as T;
  }
  if (payload === null || typeof payload !== 'object') {
    return payload;
  }
  if (payload instanceof Date) {
    return payload;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isInternalField(key)) continue;
    out[key] = stripInternalFields(value);
  }
  return out as T;
}

/** Every deny-listed field path found in a payload. Empty array means clean. */
export function findInternalFields(payload: unknown, path = '$'): string[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((item, i) => findInternalFields(item, `${path}[${i}]`));
  }
  if (payload === null || typeof payload !== 'object' || payload instanceof Date) {
    return [];
  }
  const found: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (isInternalField(key)) {
      found.push(`${path}.${key}`);
      continue;
    }
    found.push(...findInternalFields(value, `${path}.${key}`));
  }
  return found;
}

/**
 * Test/runtime assertion for client-facing responses. Use this in the response
 * path of every client endpoint so a newly added internal field fails a test
 * instead of silently reaching a homeowner.
 */
export function assertNoInternalFields(payload: unknown, context = 'client response'): void {
  const leaked = findInternalFields(payload);
  if (leaked.length > 0) {
    throw new Error(
      `§9.3 violation: ${context} contains internal field(s): ${leaked.join(', ')}`,
    );
  }
}
