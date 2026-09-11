import type { Project } from './data/types.ts';
import type { ProjectSigning } from './signed-work.ts';

/**
 * Which projects the Projects screen shows.
 *
 * John, 2026-09-12, in two parts:
 *
 *   > available projects should show when stage = awarded. That's what you
 *   > will show as projects. Also status must be signed, or won
 *   > …
 *   > both active and awarded should go through
 *
 * ---------------------------------------------------------------------------
 * TWO CONDITIONS, AND THEY ARE NOT THE SAME CONDITION
 *
 * **The stage** must be `awarded` or `active` — BuildSuite's own words for a
 * job that has been given to this contractor, and one that is under way. They
 * live in `projects.status` and reach us as `sourceStatus`, deliberately NOT
 * `projectStage`, which is the §7 GHL pipeline (`New Project` … `Warranty`) and
 * contains neither word. The two vocabularies are separate and mapping one onto
 * the other is lossy both ways (see `buildsuite/projects.ts`).
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
 * THE STAGE HALF IS THE LOOSE ONE. THE MONEY HALF IS WHAT FILTERS.
 *
 * Measured the same day, and worth knowing before anyone widens the stage list
 * again:
 *
 *   stage `awarded`   3 projects — all 3 signed
 *   stage `active`   43 projects — **1** signed
 *
 * So admitting `active` alongside `awarded` adds exactly one project, not
 * forty-three. The other forty-two are held back by the money half, which is
 * doing nearly all of the work. `draft`, `matched`, `new` and `completed` stay
 * out on stage alone.
 *
 * The one it admits is `BSA-052`, Sing's `[HUB TEST]` record — a real signed
 * proposal on a project that never went through the award path. Under the
 * awarded-only rule it vanished from this screen, which is why `active` was
 * added.
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
 * `completed`. `completed` is deliberately absent: finished work belongs on
 * the archive, not on the list of what a contractor is running today.
 */
export const AVAILABLE_SOURCE_STATUSES: readonly string[] = ['awarded', 'active'];

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
  /** Held back on stage — draft, matched, new, completed. */
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
      ? 'No projects are live and signed yet'
      : `Showing ${summary.available} ${
          summary.available === 1 ? 'project' : 'projects'
        } on a signed or won proposal`;

  return `${shown} — ${parts.join(', ')}.`;
}
