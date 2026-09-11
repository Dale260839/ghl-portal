import type { Project } from './data/types.ts';
import type { ProjectSigning } from './signed-work.ts';

/**
 * Which projects the Projects screen shows.
 *
 * John, 2026-09-12, in two parts:
 *
 *   > available projects should show when stage = awarded. That's what you
 *   > will show as projects. Also status must be signed, or won
 *
 * `active` was briefly admitted alongside `awarded` and then removed the same
 * day: the project it was meant to rescue was missing for a different reason
 * entirely (see the note on the stage list), and widening the stage was the
 * wrong fix for it.
 *
 * ---------------------------------------------------------------------------
 * TWO CONDITIONS, AND THEY ARE NOT THE SAME CONDITION
 *
 * **The stage** must be `awarded` — BuildSuite's word for a job that has been
 * given to this contractor. It lives in `projects.status` and reaches us as
 * `sourceStatus`, deliberately NOT `projectStage`, which is the §7 GHL pipeline
 * (`New Project` … `Warranty`) and contains no `awarded` at all. The two
 * vocabularies are separate and mapping one onto the other is lossy both ways
 * (see `buildsuite/projects.ts`).
 *
 * **Signed or won** is the money question: did the homeowner actually agree.
 * `signed` is a signature on the proposal. `won` is the proposal being
 * accepted — the sales word for the same outcome, and the one that can arrive
 * first, because a deal is won when the client says yes and signed when the
 * paperwork catches up.
 *
 * Measured 2026-09-12 across 108 live projects: `accepted` and `SIGNED` are
 * **the same 8 proposals**, so today the two halves of "signed, or won" never
 * disagree. They are both honoured anyway, because the day they diverge is the
 * day a contractor has a won job that has not been countersigned yet, and
 * dropping it off their Projects list is exactly the wrong moment to do it.
 *
 * ---------------------------------------------------------------------------
 * WHY `active` IS NOT ON THE LIST, THOUGH IT WAS FOR AN HOUR
 *
 * A third awarded-and-signed project — `BSA-053` — was missing from the screen
 * while appearing on the dashboard and opening fine when clicked. Admitting
 * stage `active` looked like it fixed that, because the one project it let in
 * happened to be signed. It was the wrong diagnosis.
 *
 * `BSA-053` has **`auth_profile_id = null`**. Every BuildSuite project read
 * filters on that column, so an ownerless row matches nobody's tenant and never
 * reaches a listing at all — whatever its stage. Its proposal names the owner
 * instead (`proposals.user_id`), which is why the dashboard, reading proposals,
 * could see work the projects list could not. The fix is
 * `listProjectRows` adopting those rows, not a looser stage.
 *
 * Widening the stage would also have been expensive in the wrong direction:
 * 43 live projects are `active` and exactly one of them is signed, so it
 * admitted one row and put forty-two more through the money check for nothing.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A DISPLAY RULE, NOT AN ACCESS RULE
 *
 * It decides what the Projects LIST shows. It is not a permission: a project
 * hidden here is still reachable by id, still reads under the same tenant
 * scope, and still gates on §9.1 for a client. Tenancy is `assertScope` and
 * `assertContractor`, and nothing about narrowing a list may be mistaken for
 * them.
 * ---------------------------------------------------------------------------
 */

/**
 * BuildSuite stage words that can reach the Projects screen, verbatim from
 * `projects.status`.
 *
 * The full live vocabulary is `matched`, `active`, `draft`, `new`, `awarded`,
 * `completed`. Only `awarded` shows. A project missing from this screen is far
 * more likely to be missing for the reason in the note above than to need
 * another word adding here — check `auth_profile_id` before widening this.
 */
export const AVAILABLE_SOURCE_STATUSES: readonly string[] = ['awarded'];

/**
 * `proposals.status` values that mean the client said yes.
 *
 * `accepted` is the only one BuildSuite writes today — `draft`, `submitted` and
 * `accepted` are the whole vocabulary across 50 rows. `won` is listed because
 * it is the word used for this state elsewhere in the stack and costs nothing
 * to recognise; nothing in BuildSuite emits it yet.
 */
export const WON_PROPOSAL_STATUSES: readonly string[] = ['accepted', 'won'];

/**
 * Is this project at a stage that can be shown?
 *
 * Compared case-insensitively and trimmed, because this is a free-text column
 * on somebody else's database. An exact-match check on a status column is how a
 * screen empties itself the day the value arrives capitalised.
 */
export function isAvailableStage(project: Pick<Project, 'sourceStatus'>): boolean {
  return AVAILABLE_SOURCE_STATUSES.includes((project.sourceStatus ?? '').trim().toLowerCase());
}

/**
 * Did the client agree — by signature, or by the proposal being won?
 *
 * `signing.status === 'signed'` is the signature. The proposal's own status
 * carries the won half. `unknown` — no proposal at all — is not agreement:
 * there is nobody's price on it to have agreed to.
 */
export function isSignedOrWon(signing: ProjectSigning): boolean {
  if (signing.status === 'signed') return true;
  const status = (signing.proposal?.status ?? '').trim().toLowerCase();
  return WON_PROPOSAL_STATUSES.includes(status);
}

/** Both conditions. The rule itself, in one place. */
export function isAvailableProject(signing: ProjectSigning): boolean {
  return isAvailableStage(signing.project) && isSignedOrWon(signing);
}

export interface AvailableSummary {
  /** Everything the tenant can list, before this rule. */
  readonly total: number;
  /** What the screen shows. */
  readonly available: number;
  /** Held back on stage — anything that is not `awarded`. */
  readonly otherStage: number;
  /**
   * At a live stage, but nobody has signed or won it.
   *
   * **The row worth chasing**, and the reason this is counted apart from
   * `otherStage` rather than summed into one hidden total.
   */
  readonly notAgreed: number;
}

export function summarizeAvailable(rows: readonly ProjectSigning[]): AvailableSummary {
  let available = 0;
  let otherStage = 0;
  let notAgreed = 0;

  for (const row of rows) {
    if (!isAvailableStage(row.project)) otherStage += 1;
    else if (isSignedOrWon(row)) available += 1;
    else notAgreed += 1;
  }

  return { total: rows.length, available, otherStage, notAgreed };
}

export function availableProjects(rows: readonly ProjectSigning[]): ProjectSigning[] {
  return rows.filter(isAvailableProject);
}

/**
 * What the screen says above the table.
 *
 * The two held-back counts are reported SEPARATELY and never added together,
 * because they mean opposite things to a contractor. "At another stage" is the
 * pipeline working. "Not signed or won" is a live job nobody has closed, and
 * burying it inside one hidden-count total is how it stops being chased.
 *
 * Returns null when nothing is held back — a banner that never goes away is a
 * banner people stop reading.
 */
export function availableProjectsBanner(summary: AvailableSummary): string | null {
  if (summary.total === 0) return null;

  const parts: string[] = [];
  if (summary.otherStage > 0) parts.push(`${summary.otherStage} at another stage`);
  if (summary.notAgreed > 0) parts.push(`${summary.notAgreed} not signed or won`);
  if (parts.length === 0) return null;

  const shown =
    summary.available === 0
      ? 'No projects are awarded and signed yet'
      : `Showing ${summary.available} ${
          summary.available === 1 ? 'project' : 'projects'
        } on a signed or won proposal`;

  return `${shown} — ${parts.join(', ')}.`;
}
