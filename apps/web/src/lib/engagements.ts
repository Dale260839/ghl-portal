import {
  isLiveEngagement,
  pickCurrentProposal,
  type Proposal,
} from './buildsuite/proposals.ts';
import type { Project } from './data/types.ts';

/**
 * An **engagement** — a job someone is actually doing.
 *
 * This is the unit the contractor dashboard is built around, and it replaces
 * "every project on the account" as the front page. The distinction the product
 * turns on:
 *
 *   a **lead** is an enquiry — someone filled in a form
 *   an **engagement** is work — a contractor has proposed on it, for a price
 *
 * The Hub is a project-management system. It manages engagements. Leads remain
 * visible behind a filter because deleting information is not our call, but they
 * are not what a project manager opens in the morning.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROPOSAL IS THE SPINE AND THE DEAL IS NOT
 *
 * Measured 2026-08-31. `deals` carries 182 rows of which 165 are blank or test
 * entries, 5 have a matched contractor and none records a signature.
 * `proposals` carries 46 rows: 34 with a contractor, 19 live, and **4 signed
 * with Adobe agreement ids**. The deal says who asked. The proposal says who is
 * doing it, for how much, and whether they signed.
 * ---------------------------------------------------------------------------
 */

export type EngagementStage =
  /** A price is out. Nobody has said yes. */
  | 'proposed'
  /** The client said yes; no signature captured yet. */
  | 'accepted'
  /** Signed. This is real work. */
  | 'signed';

export interface Engagement {
  /** The project id — the join key, and the id every Hub record hangs off. */
  projectId: string;
  stage: EngagementStage;
  /** The proposal that decided the stage. */
  proposal: Proposal;
  /** How many proposals point at this project. >1 is common and not an error. */
  proposalCount: number;
  contractorId: string | null;

  // ── From the project row, when we can read it ────────────────────────────
  /**
   * **null when BuildSuite's RLS hides the project from our key.**
   *
   * Not hypothetical and not rare where it counts: the single signed project in
   * the database is exactly this case. An engagement with an unreadable project
   * is still shown — losing the only signed job because a policy hid its title
   * would be the worst possible failure mode.
   */
  project: Project | null;
  title: string;
  clientName: string;
  address: string;
}

export interface EngagementInputs {
  proposals: Proposal[];
  /** Projects the caller already read under a tenant scope. */
  projects: Project[];
}

function stageOf(proposal: Proposal): EngagementStage {
  if (proposal.signed) return 'signed';
  if (proposal.accepted) return 'accepted';
  return 'proposed';
}

/**
 * Build the book of work.
 *
 * Grouped by project, because a project is the thing being managed and several
 * proposals can point at one. Sorted so signed work is first — a project manager
 * opens this to run jobs, not to browse quotes.
 */
export function buildEngagements({ proposals, projects }: EngagementInputs): Engagement[] {
  const byId = new Map(projects.map((p) => [p.buildsuiteProjectId, p]));

  const grouped = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    if (!isLiveEngagement(proposal)) continue;
    const list = grouped.get(proposal.projectId);
    if (list === undefined) grouped.set(proposal.projectId, [proposal]);
    else list.push(proposal);
  }

  const engagements: Engagement[] = [];
  for (const [projectId, list] of grouped) {
    const current = pickCurrentProposal(list);
    if (current === null) continue;

    const project = byId.get(projectId) ?? null;
    engagements.push({
      projectId,
      stage: stageOf(current),
      proposal: current,
      proposalCount: list.length,
      contractorId: current.contractorId,
      project,
      // A readable project supplies the words; otherwise say plainly that we
      // cannot see it rather than inventing a name or showing a bare UUID.
      title: project?.projectName ?? 'Project details not readable',
      clientName: project?.clientName ?? '',
      address: project?.projectAddress ?? '',
    });
  }

  const order: Record<EngagementStage, number> = { signed: 0, accepted: 1, proposed: 2 };
  return engagements.sort((a, b) => {
    const d = order[a.stage] - order[b.stage];
    return d !== 0 ? d : b.proposal.updatedAt.localeCompare(a.proposal.updatedAt);
  });
}

export interface EngagementSummary {
  total: number;
  signed: number;
  accepted: number;
  proposed: number;
  /** Engagements whose project row our key cannot read. Stated, never hidden. */
  unreadableProjects: number;
  /** Sum of the amounts BuildSuite actually holds. Never estimated. */
  knownValue: number;
  /** How many carry no numeric amount, so `knownValue` is understood as partial. */
  withoutAmount: number;
}

export function summarizeEngagements(engagements: Engagement[]): EngagementSummary {
  return {
    total: engagements.length,
    signed: engagements.filter((e) => e.stage === 'signed').length,
    accepted: engagements.filter((e) => e.stage === 'accepted').length,
    proposed: engagements.filter((e) => e.stage === 'proposed').length,
    unreadableProjects: engagements.filter((e) => e.project === null).length,
    knownValue: engagements.reduce((sum, e) => sum + (e.proposal.amount ?? 0), 0),
    withoutAmount: engagements.filter((e) => e.proposal.amount === null).length,
  };
}

/**
 * Projects with no live proposal — leads, in engagement terms.
 *
 * Returned rather than discarded so the "Leads" filter has something to show and
 * nobody concludes the system lost their data.
 */
export function leadProjects(projects: Project[], engagements: Engagement[]): Project[] {
  const engaged = new Set(engagements.map((e) => e.projectId));
  return projects.filter((p) => !engaged.has(p.buildsuiteProjectId));
}
