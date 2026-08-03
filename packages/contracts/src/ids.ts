/**
 * The shared key. ARCHITECTURE.md §5.
 *
 * `BuildSuite Project ID` is the ONLY join key across BuildSuite, GHL, and
 * Supabase. Never match records by name, address, email, or opportunity title
 * (§3.6) — those change, this does not.
 */

/** `BSP-YYYY-NNNNNN` — e.g. `BSP-2026-000184` (§5). */
export const PROJECT_ID_PATTERN = /^BSP-(\d{4})-(\d{6})$/;

/** Test fixture ID used by Phase 0 Test B (§15). Not a production format. */
export const TEST_PROJECT_ID = 'BSP-TEST-001';

export const TEST_PROJECT_ID_PATTERN = /^BSP-TEST-(\d{3})$/;

export type BuildSuiteProjectId = string & { readonly __brand: 'BuildSuiteProjectId' };

/** True for production IDs only. Test fixtures deliberately do not pass. */
export function isProjectId(value: unknown): value is BuildSuiteProjectId {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

/** True for production IDs and Phase 0 test fixtures. */
export function isProjectIdOrFixture(value: unknown): value is BuildSuiteProjectId {
  return (
    typeof value === 'string' &&
    (PROJECT_ID_PATTERN.test(value) || TEST_PROJECT_ID_PATTERN.test(value))
  );
}

/**
 * Throws rather than returning a default. An unparseable project ID means the
 * join key is wrong, and every downstream record would attach to the wrong
 * project — fail loudly at the boundary.
 */
export function assertProjectId(value: unknown, context = 'value'): BuildSuiteProjectId {
  if (!isProjectIdOrFixture(value)) {
    throw new TypeError(
      `${context} is not a BuildSuite Project ID (expected BSP-YYYY-NNNNNN, got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

export function formatProjectId(year: number, sequence: number): BuildSuiteProjectId {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`year must be a 4-digit integer, got ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999_999) {
    throw new RangeError(`sequence must be an integer in 0..999999, got ${sequence}`);
  }
  return `BSP-${year}-${String(sequence).padStart(6, '0')}` as BuildSuiteProjectId;
}
