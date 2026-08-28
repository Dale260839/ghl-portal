/**
 * The shared key: one place, because C-3 is not decided.
 *
 * ---------------------------------------------------------------------------
 * **PROPOSED, NOT CONFIRMED.** `SOURCE-OF-TRUTH.md` C-3 records three answers
 * for what links a project across BuildSuite and GoHighLevel, and D4 §6
 * contradicts itself. Chris has not chosen. Sing cannot start the handoff stamp
 * until he does.
 *
 * Everything downstream reads `SHARED_KEY` from here, so a reversal is one edit
 * rather than a hunt. Do not inline a choice anywhere else.
 * ---------------------------------------------------------------------------
 *
 * **Measured, not assumed** (`docs/kb/two-system-model.md`):
 *
 * - There is no `BSP-` value anywhere in BuildSuite's `projects` table, and no
 *   column that would hold one. The §8.2 contract still *requires* the
 *   `BSP-YYYY-NNNNNN` format, so today no real row could pass it.
 * - `ghl_opportunity_id` exists on every row and is **empty on all of them**.
 * - `projects.id` is real and populated, which is why it is the stopgap.
 *
 * So both documented candidates carry no data. That is the finding, and it is
 * why this file exists instead of a constant buried in a planner.
 */

/** The candidates C-3 is choosing between. */
export type SharedKeyChoice =
  /** ARCHITECTURE §3.6 + D1: BuildSuite generates `BSP-YYYY-NNNNNN`. */
  | 'buildsuite_project_id'
  /** D4 §6's second half: GoHighLevel's opportunity id. */
  | 'ghl_opportunity_id'
  /** The stopgap: BuildSuite's own row id. Real and populated today. */
  | 'buildsuite_row_id';

/**
 * The proposal on the table: **BuildSuite generates it, GoHighLevel copies it.**
 *
 * Chosen because it is the only option where the key exists before the record
 * it identifies. GoHighLevel's opportunity id is created after the handoff, so
 * keying on it means the first message has nothing to key on.
 */
export const SHARED_KEY: SharedKeyChoice = 'buildsuite_project_id';

/** Whether the choice has been confirmed by Chris. Flip when it is. */
export const SHARED_KEY_CONFIRMED = false;

/** Who creates the value. The other side copies it and never types it (D4 §6). */
export const SHARED_KEY_OWNER = 'BuildSuite' as const;

/**
 * The field name the key must live in, on both sides.
 *
 * §3.6 and D4 §10: never a job title, a name, or an address. A rename would
 * break the link silently and show the wrong data on a job site.
 */
export const SHARED_KEY_FIELD = 'buildsuite_project_id' as const;

/** A one-line statement of the current position, for docs and screens. */
export function sharedKeyStatus(): string {
  const state = SHARED_KEY_CONFIRMED ? 'confirmed' : 'PROPOSED — awaiting Chris (C-3)';
  return `${SHARED_KEY_OWNER} generates \`${SHARED_KEY_FIELD}\`; the other side copies it. ${state}.`;
}
