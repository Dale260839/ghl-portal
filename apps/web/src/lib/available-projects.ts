import type { Project } from './data/types.ts';
import type { ProjectSigning } from './signed-work.ts';

/**
 * Which projects the Projects screen shows. Chris/John, 2026-09-12:
 *
 *   > available projects should show when stage = awarded. That's what you
 *   > will show as projects. Also status must be signed, or won
 *
 * ---------------------------------------------------------------------------
 * TWO CONDITIONS, AND THEY ARE NOT THE SAME CONDITION
 *
 * **Stage `awarded`** is BuildSuite's word for "this job was given to this
 * contractor". It lives in `projects.status` and reaches us as
 * `sourceStatus` — deliberately NOT `projectStage`, which is the §7 GHL
 * pipeline (`New Project` … `Warranty`) and contains no `awarded` at all. The
 * two vocabularies are separate and mapping one onto the other is lossy both
 * ways (see `buildsuite/projects.ts`).
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
 * WHY BOTH, RATHER THAN EITHER
 *
 * Each alone is wrong in a way that shows up in the live data:
 *
 *   · **Stage alone** — nothing checks that anyone agreed a price. BuildSuite
 *     could mark a job awarded before the contract comes back.
 *   · **Signed alone** — `BSA-052` is signed and sits at stage `active`, not
 *     `awarded`. It is Sing's `[HUB TEST]` record, which is a real signed
 *     proposal on a project that was never awarded through the normal path.
 *
 * So `BSA-052` DOES disappear from Projects under this rule. That is the rule
 * working, not a bug, and it is written down here because it is the kind of
 * thing somebody finds later and reports as one.
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

/** BuildSuite's award word, verbatim from `projects.status`. */
export const AWARDED_SOURCE_STATUS = 'awarded';

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
 * Is this project at stage `awarded`?
 *
 * Compared case-insensitively and trimmed, because this is a free-text column
 * on somebody else's database. An exact-match check on a status column is how a
 * screen empties itself the day the value arrives capitalised.
 */
export function isAwarded(project: Pick<Project, 'sourceStatus'>): boolean {
  return (project.sourceStatus ?? '').trim().toLowerCase() === AWARDED_SOURCE_STATUS;
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
  return isAwarded(signing.project) && isSignedOrWon(signing);
}

export interface AvailableSummary {
  /** Everything the tenant can list, before this rule. */
  readonly total: number;
  /** What the screen shows. */
  readonly available: number;
  /** Held back for not being awarded yet. */
  readonly notAwarded: number;
  /** Awarded, but nobody has signed or won it — the row worth chasing. */
  readonly awardedNotAgreed: number;
}

export function summarizeAvailable(rows: readonly ProjectSigning[]): AvailableSummary {
  let available = 0;
  let notAwarded = 0;
  let awardedNotAgreed = 0;

  for (const row of rows) {
    if (!isAwarded(row.project)) notAwarded += 1;
    else if (isSignedOrWon(row)) available += 1;
    else awardedNotAgreed += 1;
  }

  return { total: rows.length, available, notAwarded, awardedNotAgreed };
}

export function availableProjects(rows: readonly ProjectSigning[]): ProjectSigning[] {
  return rows.filter(isAvailableProject);
}

/**
 * What the screen says above the table.
 *
 * The two held-back counts are reported SEPARATELY and never added together,
 * because they mean opposite things to a contractor. "Not awarded yet" is the
 * pipeline working. "Awarded but nobody has signed" is a job to chase, and
 * burying it inside one hidden-count total is how it stops being chased.
 *
 * Returns null when nothing is held back — a banner that never goes away is a
 * banner people stop reading.
 */
export function availableProjectsBanner(summary: AvailableSummary): string | null {
  if (summary.total === 0) return null;

  const parts: string[] = [];
  if (summary.notAwarded > 0) {
    parts.push(`${summary.notAwarded} not awarded yet`);
  }
  if (summary.awardedNotAgreed > 0) {
    parts.push(
      `${summary.awardedNotAgreed} awarded but ${
        summary.awardedNotAgreed === 1 ? 'it is' : 'they are'
      } not signed or won`,
    );
  }
  if (parts.length === 0) return null;

  const shown =
    summary.available === 0
      ? 'No projects are awarded and signed yet'
      : `Showing ${summary.available} awarded ${
          summary.available === 1 ? 'project' : 'projects'
        } on a signed or won proposal`;

  return `${shown} — ${parts.join(', ')}.`;
}
