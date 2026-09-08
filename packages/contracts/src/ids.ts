/**
 * The shared key. ARCHITECTURE.md §5, as amended by decision C-3.
 *
 * The project code is the ONLY join key across BuildSuite, GHL, and Supabase.
 * Never match records by name, address, email, or opportunity title (§3.6) —
 * those change, this does not.
 *
 * ---------------------------------------------------------------------------
 * C-3 — RESOLVED 2026-09-01 (Chris). THE FORMAT CHANGED.
 *
 * §5 specifies `BSP-YYYY-NNNNNN`. **BuildSuite has never had a column in that
 * format and does not today.** The two candidates it does have are:
 *
 *   `projects.id`           a UUID
 *   `projects.project_code` `BSA-044` or `BSA-ASJF-006` — see below
 *
 * Chris confirmed the key is `project_code`. Measured against the live database
 * on 2026-09-03, and his recollection of the coverage was exact:
 *
 *   103 projects · 50 carry a project_code · 0 duplicates (2026-09-08)
 *
 * So `BSA-NNN` is the production format. `BSP-YYYY-NNNNNN` is kept as a
 * recognised LEGACY format rather than deleted: it is what every fixture and
 * every document written before today uses, and silently rejecting it would
 * turn a format migration into a fleet of unexplained validation failures.
 * Nothing mints it any more.
 *
 * STILL OPEN, and NOT resolved here: the one live record in GoHighLevel's
 * `custom_objects.projects` keys on a **UUID**, not on the BSA code. Chris and
 * that record disagree. Accepting `BSA-NNN` is our half; until the GHL side is
 * wired to the same key, a handoff still will not join. Do not paper over this
 * by also accepting UUIDs — that would make the join key "any string", which is
 * not a join key.
 * ---------------------------------------------------------------------------
 */

/**
 * WIDENED 2026-09-08. This was `/^BSA-(\d{3})$/` — three digits, inferred from
 * the 50 codes that exist today. Sing confirmed on 2026-09-03, against deployed
 * BuildSuite code, that there are TWO shapes and allocation is a Postgres
 * function at insert time:
 *
 *   BSA-044        feed and client projects, one Alliance-wide series
 *   BSA-ASJF-006   contractor-created, four letters the contractor picks
 *
 * The old pattern rejected every contractor-created code, and would have
 * rejected the feed series itself at BSA-1000.
 */
export const PROJECT_CODE_PATTERN = /^BSA-(?:\d+|[A-Z]{2,6}-\d+)$/;

/**
 * `BSP-YYYY-NNNNNN` — e.g. `BSP-2026-000184` (§5 as originally written).
 *
 * Accepted, never minted. See the C-3 note above.
 */
export const LEGACY_PROJECT_ID_PATTERN = /^BSP-(\d{4})-(\d{6})$/;

/**
 * @deprecated Use `PROJECT_CODE_PATTERN` for the production key, or
 * `LEGACY_PROJECT_ID_PATTERN` when you specifically mean the old format.
 * Retained so existing imports keep compiling through the migration.
 */
export const PROJECT_ID_PATTERN = LEGACY_PROJECT_ID_PATTERN;

/** Test fixture ID used by Phase 0 Test B (§15). Not a production format. */
export const TEST_PROJECT_ID = 'BSP-TEST-001';

export const TEST_PROJECT_ID_PATTERN = /^BSP-TEST-(\d{3})$/;

export type BuildSuiteProjectId = string & { readonly __brand: 'BuildSuiteProjectId' };

/** True only for the production format a new record should carry (C-3). */
export function isProjectCode(value: unknown): value is BuildSuiteProjectId {
  return typeof value === 'string' && PROJECT_CODE_PATTERN.test(value);
}

/**
 * True for any key the system will accept as a join key: the production code
 * and the legacy format. Test fixtures deliberately do not pass.
 */
export function isProjectId(value: unknown): value is BuildSuiteProjectId {
  return (
    typeof value === 'string' &&
    (PROJECT_CODE_PATTERN.test(value) || LEGACY_PROJECT_ID_PATTERN.test(value))
  );
}

/** True for accepted production keys and Phase 0 test fixtures. */
export function isProjectIdOrFixture(value: unknown): value is BuildSuiteProjectId {
  return isProjectId(value) || (typeof value === 'string' && TEST_PROJECT_ID_PATTERN.test(value));
}

/**
 * Throws rather than returning a default. An unparseable project ID means the
 * join key is wrong, and every downstream record would attach to the wrong
 * project — fail loudly at the boundary.
 */
export function assertProjectId(value: unknown, context = 'value'): BuildSuiteProjectId {
  if (!isProjectIdOrFixture(value)) {
    throw new TypeError(
      `${context} is not a BuildSuite project key (expected BSA-044 or BSA-ASJF-006, got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

/**
 * Format a key for display or a fixture. **Not an allocator.**
 *
 * BuildSuite mints these in a Postgres function at insert time (Sing,
 * 2026-09-03). Nothing here should ever be the source of a real code — the
 * sequence would collide the moment two writers ran.
 *
 * `formatProjectCode(2)` → `BSA-002`; `formatProjectCode(6, 'ASJF')` →
 * `BSA-ASJF-006`. Zero-padded to three for readability, but longer numbers are
 * accepted by the pattern, so the series is not capped at 999.
 */
export function formatProjectCode(sequence: number, contractor?: string): BuildSuiteProjectId {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(`sequence must be a non-negative integer, got ${sequence}`);
  }
  const digits = String(sequence).padStart(3, '0');
  if (contractor === undefined) return `BSA-${digits}` as BuildSuiteProjectId;

  const prefix = contractor.trim().toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(prefix)) {
    throw new RangeError(`contractor prefix must be 2-6 letters, got ${JSON.stringify(contractor)}`);
  }
  return `BSA-${prefix}-${digits}` as BuildSuiteProjectId;
}

/**
 * @deprecated Mints the legacy `BSP-YYYY-NNNNNN` format, which nothing should
 * create any more. Use `formatProjectCode`. Retained for the fixtures that
 * still construct ids in the old shape.
 */
export function formatProjectId(year: number, sequence: number): BuildSuiteProjectId {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`year must be a 4-digit integer, got ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 999_999) {
    throw new RangeError(`sequence must be an integer in 0..999999, got ${sequence}`);
  }
  return `BSP-${year}-${String(sequence).padStart(6, '0')}` as BuildSuiteProjectId;
}
