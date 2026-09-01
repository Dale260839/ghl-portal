import { pickCurrentProposal, type Proposal } from './buildsuite/proposals.ts';
import type { Project } from './data/types.ts';

/**
 * Joining `proposals` to `projects`, and narrowing the list to signed work.
 *
 * ---------------------------------------------------------------------------
 * THIS READ `deals` UNTIL 2026-09-01 AND IT WAS WRONG.
 *
 * `isSignedWork` used to mean `deals.signature_signed_at || deals.sent_to_crm_at`.
 * Sing confirmed that `deals` is the DealsEngine flow and has nothing to do with
 * matching or signing, and the screen proved him right: two projects showed as
 * **Signed** on `sent_to_crm_at` alone, and one of them ("mike kitchen") had no
 * proposal at all. A project with nobody's price on it was being labelled as
 * won work.
 *
 * Signature lives on `proposals` — `signature_status` and `signature_signed_at`
 * — alongside the contractor doing the work. So this joins proposals now, and
 * agrees with the Active Work screen instead of contradicting it.
 * ---------------------------------------------------------------------------
 *
 * **The key is `proposals.project_id → projects.buildsuiteProjectId`.**
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT DECIDES THE WHOLE FILE
 *
 * A project can be in three states, not two:
 *
 *   **signed**   — it has a proposal, and that proposal was signed
 *   **unsigned** — it has a proposal, and it was not signed
 *   **unknown**  — no proposal points at it, so we cannot say either way
 *
 * The filter hides only `unsigned`. An `unknown` project stays on the list.
 *
 * That is deliberate and it is the conservative direction: we hide work only
 * when we hold positive evidence it is unsigned. Measured on the Alliance
 * database, 46 proposals cover far fewer than 101 projects, so most projects
 * have no proposal at all. Treating "no proposal" as "not signed" would hide
 * most of the book of
 * work, and to a contractor that is indistinguishable from data loss.
 * ---------------------------------------------------------------------------
 */

export type SignedStatus = 'signed' | 'unsigned' | 'unknown';

export interface ProjectSigning {
  project: Project;
  status: SignedStatus;
  /** The proposal that decided it, when there is one. */
  proposal: Proposal | null;
}

/**
 * Index proposals by the project they are for.
 *
 * A project can carry several — the one signed project in the database has
 * seven — so `pickCurrentProposal` decides which represents it: signed over
 * accepted over submitted, then most recent. Without an explicit rule, whichever
 * row came back first would decide whether a contractor sees their own signed
 * job.
 */
export function indexProposalsByProject(proposals: Proposal[]): Map<string, Proposal> {
  const grouped = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    const list = grouped.get(proposal.projectId);
    if (list === undefined) grouped.set(proposal.projectId, [proposal]);
    else list.push(proposal);
  }

  const byProject = new Map<string, Proposal>();
  for (const [projectId, list] of grouped) {
    const current = pickCurrentProposal(list);
    if (current !== null) byProject.set(projectId, current);
  }
  return byProject;
}

export function signingOf(project: Project, byProject: Map<string, Proposal>): ProjectSigning {
  const proposal = byProject.get(project.buildsuiteProjectId) ?? null;
  if (proposal === null) return { project, status: 'unknown', proposal: null };
  return { project, status: proposal.signed ? 'signed' : 'unsigned', proposal };
}

export function joinProposalsToProjects(
  projects: Project[],
  proposals: Proposal[],
): ProjectSigning[] {
  const byProject = indexProposalsByProject(proposals);
  return projects.map((project) => signingOf(project, byProject));
}

export interface SignedWorkSummary {
  total: number;
  signed: number;
  unsigned: number;
  /** No proposal points at these. They are never hidden. */
  unknown: number;
  /** How many rows the filter would remove if it were switched on right now. */
  wouldHide: number;
  /** True when switching the filter on would empty the list. */
  filterWouldEmpty: boolean;
}

export function summarizeSignedWork(rows: ProjectSigning[]): SignedWorkSummary {
  const signed = rows.filter((r) => r.status === 'signed').length;
  const unsigned = rows.filter((r) => r.status === 'unsigned').length;
  const unknown = rows.filter((r) => r.status === 'unknown').length;

  return {
    total: rows.length,
    signed,
    unsigned,
    unknown,
    wouldHide: unsigned,
    filterWouldEmpty: rows.length > 0 && signed + unknown === 0,
  };
}

/** Hides only what we can prove is unsigned. See the rule at the top. */
export function applySignedOnly(rows: ProjectSigning[], on: boolean): ProjectSigning[] {
  return on ? rows.filter((r) => r.status !== 'unsigned') : rows;
}

/**
 * The filter's off switch — **off unless explicitly enabled**.
 *
 * The inverse of how `DISABLE_VIEW_AS` works, and on purpose. Nothing in the
 * database is signed: 4 proposals, all on one project. So switching this on
 * today removes nearly everything and leaves only the ones we cannot
 * judge. A contractor opening the dashboard to a near-empty list would read it
 * as the product being broken, and they would be right to.
 *
 * It ships tested and one environment variable from working, which is what Sing
 * asked for. It does not ship on.
 */
export function signedOnlyFilterEnabled(): boolean {
  return process.env.ENABLE_SIGNED_ONLY_FILTER === 'true';
}

/**
 * What the projects list says above the table.
 *
 * Returns null once the picture is unremarkable — a banner that never goes away
 * is a banner people stop reading. It disappears when there is nothing unsigned
 * to warn about.
 */
export function signedWorkBanner(summary: SignedWorkSummary, filterOn: boolean): string | null {
  if (summary.total === 0) return null;

  if (filterOn) {
    return summary.wouldHide === 0
      ? null
      : `Showing signed work only. ${summary.wouldHide} unsigned ${
          summary.wouldHide === 1 ? 'project is' : 'projects are'
        } hidden.`;
  }

  if (summary.signed === 0) {
    const scope =
      summary.unknown === 0
        ? `None of these ${summary.total} projects has a signed proposal`
        : `None of these ${summary.total} projects has a signed proposal (${summary.unknown} ${
            summary.unknown === 1 ? 'has' : 'have'
          } no proposal to check)`;
    return `Showing all work. ${scope} — the signed-only filter turns on when signatures start landing.`;
  }

  return `Showing all work. ${summary.signed} of ${summary.total} ${
    summary.total === 1 ? 'project is' : 'projects are'
  } on a signed proposal.`;
}
