import { isSignedWork, type Deal } from './buildsuite/deals.ts';
import type { Project } from './data/types.ts';

/**
 * Joining `deals` to `projects`, and narrowing the list to work that was won.
 *
 * The question "which of these projects is signed work?" has been open since
 * 2026-08-20 and it blocks the filter Sing asked for. Day 1 found the answer:
 * it is not on `projects` at all, it is `signature_signed_at` / `sent_to_crm_at`
 * on the **deal**. So the filter needs a join, and the join needs a key.
 *
 * **The key is `deals.source_project_id → projects.buildsuiteProjectId`.** It is
 * the only populated link. `ghl_opportunity_id` is empty on all 182 deals and
 * `ghl_contact_id` on 180 of them, so neither could carry this today (C-3).
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT DECIDES THE WHOLE FILE
 *
 * A project can be in three states, not two:
 *
 *   **signed**   — it has a deal, and that deal was won
 *   **unsigned** — it has a deal, and that deal was not
 *   **unknown**  — no deal points at it, so we cannot say either way
 *
 * The filter hides only `unsigned`. An `unknown` project stays on the list.
 *
 * That is deliberate and it is the conservative direction: we hide work only
 * when we hold positive evidence it is unsigned. Measured on the Alliance
 * tenant, 8 of 9 projects have a deal and one has none — and across the whole
 * database only 26% of deals carry a project id at all, so the reverse join is
 * sparse. Treating "no deal" as "not signed" would hide most of the book of
 * work, and to a contractor that is indistinguishable from data loss.
 * ---------------------------------------------------------------------------
 */

export type SignedStatus = 'signed' | 'unsigned' | 'unknown';

export interface ProjectSigning {
  project: Project;
  status: SignedStatus;
  /** The deal that decided it, when there is one. */
  deal: Deal | null;
}

/**
 * Index the deals by the project they became.
 *
 * A project can have more than one deal pointing at it — nothing in BuildSuite
 * forbids it — so a *signed* deal wins over an unsigned one. Otherwise whichever
 * row happened to come back first would decide whether a contractor sees their
 * own signed job.
 */
export function indexDealsByProject(deals: Deal[]): Map<string, Deal> {
  const byProject = new Map<string, Deal>();

  for (const deal of deals) {
    if (deal.projectId === null) continue;
    const existing = byProject.get(deal.projectId);
    if (existing === undefined || (!isSignedWork(existing) && isSignedWork(deal))) {
      byProject.set(deal.projectId, deal);
    }
  }

  return byProject;
}

export function signingOf(project: Project, byProject: Map<string, Deal>): ProjectSigning {
  const deal = byProject.get(project.buildsuiteProjectId) ?? null;
  if (deal === null) return { project, status: 'unknown', deal: null };
  return { project, status: isSignedWork(deal) ? 'signed' : 'unsigned', deal };
}

export function joinDealsToProjects(projects: Project[], deals: Deal[]): ProjectSigning[] {
  const byProject = indexDealsByProject(deals);
  return projects.map((project) => signingOf(project, byProject));
}

export interface SignedWorkSummary {
  total: number;
  signed: number;
  unsigned: number;
  /** No deal points at these. They are never hidden. */
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
 * database has ever been signed: 0 of 182 deals. So switching this on today
 * removes every project that has a deal and leaves only the ones we cannot
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
        ? `None of these ${summary.total} projects is on a signed deal`
        : `None of these ${summary.total} projects is on a signed deal (${summary.unknown} ${
            summary.unknown === 1 ? 'has' : 'have'
          } no deal to check)`;
    return `Showing all work. ${scope} — the signed-only filter turns on when signatures start landing.`;
  }

  return `Showing all work. ${summary.signed} of ${summary.total} ${
    summary.total === 1 ? 'project is' : 'projects are'
  } on a signed deal.`;
}
