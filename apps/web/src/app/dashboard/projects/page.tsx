import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, HealthBadge, ProgressBar, currency, shortDate } from '@/components/ui';
import { ContractorProjectCode } from '@/components/project-code';
import { hasOperationalDetail, moneyDisplay, stageLabel, type Project } from '@/lib/data/types';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { getHubRecords } from '@/lib/hub-db/records';
import {
  joinProposalsToProjects,
  type ProjectSigning,
  type SignedStatus,
} from '@/lib/signed-work';
import {
  availableProjectsBanner,
  parseProjectView,
  PROJECT_VIEW_LABELS,
  PROJECT_VIEWS,
  projectsForView,
  projectViewCounts,
  summarizeAvailable,
  DEFAULT_PROJECT_VIEW,
  type ProjectView,
} from '@/lib/available-projects';

/**
 * Awarded · Draft · All.
 *
 * Plain links, not a client component: the view is in the URL, so switching is
 * a navigation, a filtered list can be bookmarked or sent to someone, and the
 * browser's back button undoes a filter the way people expect it to.
 *
 * Each pill carries its count, so nobody has to click one to discover it empty.
 * The default view links to the bare path rather than `?view=awarded`, so there
 * is one URL for the screen people land on.
 */
function ProjectViewPills({
  current,
  counts,
}: {
  current: ProjectView;
  counts: Record<ProjectView, number>;
}) {
  return (
    <nav aria-label="Filter projects" className="flex flex-wrap gap-2">
      {PROJECT_VIEWS.map((view) => {
        const active = view === current;
        return (
          <Link
            key={view}
            href={view === DEFAULT_PROJECT_VIEW ? '/dashboard/projects' : `/dashboard/projects?view=${view}`}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              active
                ? 'border-navy-900 bg-navy-900 text-white'
                : 'border-navy-200 bg-white text-navy-600 hover:border-navy-300 hover:bg-navy-50'
            }`}
          >
            {PROJECT_VIEW_LABELS[view]}
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${
                active ? 'bg-white/20 text-white' : 'bg-navy-100 text-navy-500'
              }`}
            >
              {counts[view]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** What an empty view says. Each one names why, rather than one "nothing here". */
const EMPTY_VIEW: Record<ProjectView, string> = {
  awarded:
    'No awarded projects on a signed or won proposal yet. Drafts and other stages are under All.',
  draft: 'No draft projects.',
  all: 'This account has no projects yet.',
};

/** How each signing state reads on a row. `unknown` says so rather than guessing. */
const SIGNING: Record<SignedStatus, { label: string; tone: 'good' | 'warn' | 'neutral' } | null> = {
  signed: { label: 'Signed', tone: 'good' },
  unsigned: { label: 'Quoted', tone: 'warn' },
  // "Deal" is the DealsEngine's word for something else entirely. A project
  // with no proposal has nobody's price on it, so that is what it says.
  unknown: { label: 'No proposal', tone: 'neutral' },
};

/**
 * One money cell, with the basis said out loud.
 *
 * A signed figure is the contract, and reads plainly. An unsigned one is a
 * quote — real, but nobody agreed to it — and a band is not a figure at all.
 * Rendering all three identically is what made a $10,000–$50,000 band sit in a
 * column headed Contract on a job whose signed proposal said $24,500.
 */
function MoneyCell({
  project,
  proposal,
}: {
  project: Project;
  proposal: { amount: number | null; signed: boolean } | null;
}) {
  const money = moneyDisplay(project, currency, proposal);
  return (
    <>
      <span className={money.basis === 'none' ? 'text-navy-400' : undefined}>{money.label}</span>
      {money.basis === 'quoted' && (
        <span className="mt-0.5 block text-xs font-normal text-navy-400">quoted, not signed</span>
      )}
      {money.basis === 'range' && (
        <span className="mt-0.5 block text-xs font-normal text-navy-400">estimated range</span>
      )}
    </>
  );
}

/**
 * The signed contract, as its own column.
 *
 * It hangs off the proposal, not the project — `proposals.signed_pdf_url`,
 * written by the GoHighLevel webhook from the document's `pdfLink` (Sing,
 * 2026-09-09). It stays null on a test fire, because their test payload carries
 * no document fields, so an empty cell here is normal rather than a fault.
 *
 * `rel="noreferrer"` because the URL is public and unauthenticated: without it
 * the storage host is told which of our pages it was opened from.
 */
function SignedPdfCell({ url }: { url: string | null }) {
  if (url === null) {
    return <span className="text-xs text-navy-400">No link available</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-medium text-navy-600 underline underline-offset-2 hover:text-navy-900"
    >
      View
    </a>
  );
}

export default async function ProjectsList({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const view = parseProjectView((await searchParams).view);
  const scope = await requireTenantScope();
  const everyProject = await (await currentDataSource(scope)).listProjects(scope);

  // Archived projects leave the working list. They are not deleted and they are
  // one click from returning — see /dashboard/archive. Filtering here rather
  // than in the data source keeps the archive a Hub concept: BuildSuite has no
  // idea any of this happened.
  const hub = getHubRecords();
  const overlays = hub.available
    ? await hub.records.getOverlays(scope, everyProject.map((p) => p.buildsuiteProjectId))
    : [];
  const archivedIds = new Set(
    overlays.filter((o) => o.archivedAt !== null).map((o) => o.projectId),
  );
  const allProjects = everyProject.filter((p) => !archivedIds.has(p.buildsuiteProjectId));
  const archivedCount = everyProject.length - allProjects.length;

  // Signature lives on `proposals`, not `deals`. Reading `deals` here labelled
  // two projects "Signed" on `sent_to_crm_at` alone — one of which had no
  // proposal at all — and contradicted the Active Work screen, which was right.
  //
  // When BuildSuite is unreachable every project is `unknown`, which is the
  // honest answer, and the filter then hides nothing.
  const reader = getProposalsReader();
  const proposals = reader.available
    ? await reader.listForProjects(scope, allProjects.map((p) => p.buildsuiteProjectId))
    : [];

  const joined: ProjectSigning[] = joinProposalsToProjects(allProjects, proposals);

  // THE RULE, from John on 2026-09-12: a project appears here when its stage is
  // `awarded` AND its proposal is signed or won. Both halves — see
  // `lib/available-projects.ts`.
  //
  // If a project is missing from this screen, check `projects.auth_profile_id`
  // before touching this rule. An ownerless row reaches no listing at all, at
  // any stage, and that — not the stage filter — is what hid `BSA-053` while
  // the dashboard showed it. The tenant filter now follows the award columns
  // (`awarded_to_auth_profile_id`), so a won project is listed for its winner.
  //
  // This replaces the `ENABLE_SIGNED_ONLY_FILTER` environment switch, which was
  // off by default and hid only what could be PROVEN unsigned. That was the
  // right shape when nothing in the database was signed; it is the wrong shape
  // now that the question has an answer.
  //
  // The pills (2026-09-12) choose between that rule, the `draft` stage, and
  // everything. Awarded stays the default — see PROJECT_VIEWS.
  const summary = summarizeAvailable(joined);
  const counts = projectViewCounts(joined);
  const rows = projectsForView(joined, view);
  // The held-back banner explains the AWARDED rule. On Draft or All nothing is
  // being held back by it, so repeating it there would describe a filter that
  // is not applied.
  const banner = view === 'awarded' ? availableProjectsBanner(summary) : null;
  const projects = rows.map((r) => r.project);
  const noun = projects.length === 1 ? 'project' : 'projects';
  const subtitle =
    view === 'awarded'
      ? `${projects.length} awarded ${noun} on a signed or won proposal`
      : view === 'draft'
        ? `${projects.length} draft ${noun}`
        : `${projects.length} ${noun} at every stage`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Projects</h1>
        <p className="mt-1 text-sm text-navy-400">
          {subtitle}
          {archivedCount > 0 && (
            <>
              {' · '}
              <Link href="/dashboard/archive" className="underline hover:text-navy-600">
                {archivedCount} archived
              </Link>
            </>
          )}
        </p>
      </div>

      <ProjectViewPills current={view} counts={counts} />

      {banner !== null && (
        <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm text-navy-600">
          {banner}
          {/* This screen can only speak about projects it can LIST. A project
              BuildSuite's RLS hides is absent entirely, signed or not — and the
              one signed project in the database is exactly that case. Active
              Work reads proposals, which stay readable, so it can legitimately
              show signed work that never appears here. Saying so beats letting
              someone find two screens disagreeing and trust neither. */}
          <span className="mt-1 block text-xs text-navy-400">
            Counts cover projects visible to this account. Work whose project record is
            restricted still appears under Active Work. Hiding a project here does not
            revoke anyone&rsquo;s access to it.
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="px-5 py-10 text-center text-sm text-navy-500">{EMPTY_VIEW[view]}</Card>
      ) : (
      <Card className="overflow-hidden">
        {/* Desktop table */}
        <table className="hidden w-full text-left md:table">
          <thead>
            <tr className="border-b border-navy-100 bg-navy-50/60 text-xs tracking-wide text-navy-400 uppercase">
              <th className="px-5 py-2.5 font-medium">Project</th>
              <th className="px-5 py-2.5 font-medium">Stage</th>
              <th className="w-44 px-5 py-2.5 font-medium">Progress</th>
              <th className="px-5 py-2.5 text-right font-medium">Contract</th>
              <th className="px-5 py-2.5 font-medium">Signed PDF</th>
              <th className="px-5 py-2.5 font-medium">Health</th>
              <th className="px-5 py-2.5 font-medium">Portal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {rows.map(({ project: p, status, proposal }) => (
              <tr key={p.buildsuiteProjectId} className="transition hover:bg-navy-50/60">
                <td className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                      className="text-sm font-medium text-navy-900 hover:underline"
                    >
                      {p.projectName}
                    </Link>
                    {SIGNING[status] !== null && (
                      <Badge tone={SIGNING[status].tone}>{SIGNING[status].label}</Badge>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {/* The contractor's code, not the UUID (John, 2026-09-12): the
                        award code when this job was won, the project code when it
                        was self-created, and the client's code beside it when the
                        two differ (Sing, 2026-09-12). */}
                    {p.clientName} · <ContractorProjectCode project={p} />
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-navy-600">{stageLabel(p)}</td>
                <td className="px-5 py-3.5">
                  {hasOperationalDetail(p) ? (
                    <ProgressBar value={p.progressPercentage} />
                  ) : (
                    <span className="text-xs text-navy-400">—</span>
                  )}
                </td>
                <td className="tabular px-5 py-3.5 text-right text-sm text-navy-900">
                  <MoneyCell project={p} proposal={proposal} />
                </td>
                <td className="px-5 py-3.5 text-sm">
                  <SignedPdfCell url={proposal?.signedPdfUrl ?? null} />
                </td>
                <td className="px-5 py-3.5">
                  {hasOperationalDetail(p) ? (
                    <HealthBadge status={p.healthStatus} />
                  ) : (
                    <span className="text-xs text-navy-400">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5">
                  {p.clientPortalEnabled ? (
                    <Badge tone="good">Enabled</Badge>
                  ) : (
                    <Badge>Off</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile cards */}
        <ul className="divide-y divide-navy-100 md:hidden">
          {rows.map(({ project: p, status, proposal }) => (
            <li key={p.buildsuiteProjectId}>
              <Link
                href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                className="block px-5 py-4 transition hover:bg-navy-50/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-navy-900">
                        {p.projectName}
                      </span>
                      {SIGNING[status] !== null && (
                        <Badge tone={SIGNING[status].tone}>{SIGNING[status].label}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {p.clientName} · {stageLabel(p)}
                    </div>
                  </div>
                  {hasOperationalDetail(p) && <HealthBadge status={p.healthStatus} />}
                </div>
                {hasOperationalDetail(p) && (
                  <div className="mt-3">
                    <ProgressBar value={p.progressPercentage} />
                  </div>
                )}
                <div className="tabular mt-2 text-xs text-navy-400">
                  <MoneyCell project={p} proposal={proposal} />
                  {p.estimatedCompletionDate !== '' &&
                    ` · due ${shortDate(p.estimatedCompletionDate)}`}
                </div>
                {/* The narrow layout has no columns, so the contract document
                    gets a line of its own rather than a bare "View". */}
                {proposal?.signedPdfUrl != null && (
                  <div className="mt-1 text-xs">
                    <span className="text-navy-400">Signed PDF · </span>
                    <SignedPdfCell url={proposal.signedPdfUrl} />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      )}
    </div>
  );
}
