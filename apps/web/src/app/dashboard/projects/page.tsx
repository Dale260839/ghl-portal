import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, HealthBadge, ProgressBar, currency, shortDate } from '@/components/ui';
import { hasOperationalDetail, moneyLabel, stageLabel } from '@/lib/data/types';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { getHubRecords } from '@/lib/hub-db/records';
import {
  applySignedOnly,
  joinProposalsToProjects,
  signedOnlyFilterEnabled,
  signedWorkBanner,
  summarizeSignedWork,
  type ProjectSigning,
  type SignedStatus,
} from '@/lib/signed-work';

/** How each signing state reads on a row. `unknown` says so rather than guessing. */
const SIGNING: Record<SignedStatus, { label: string; tone: 'good' | 'warn' | 'neutral' } | null> = {
  signed: { label: 'Signed', tone: 'good' },
  unsigned: { label: 'Quoted', tone: 'warn' },
  // "Deal" is the DealsEngine's word for something else entirely. A project
  // with no proposal has nobody's price on it, so that is what it says.
  unknown: { label: 'No proposal', tone: 'neutral' },
};

export default async function ProjectsList() {
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
  const summary = summarizeSignedWork(joined);
  const filterOn = signedOnlyFilterEnabled();
  const rows = applySignedOnly(joined, filterOn);
  const banner = signedWorkBanner(summary, filterOn);
  const projects = rows.map((r) => r.project);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Projects</h1>
        <p className="mt-1 text-sm text-navy-400">
          {projects.length} projects · every row keyed by its BuildSuite Project ID
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
            restricted still appears under Active Work.
          </span>
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <table className="hidden w-full text-left md:table">
          <thead>
            <tr className="border-b border-navy-100 bg-navy-50/60 text-xs tracking-wide text-navy-400 uppercase">
              <th className="px-5 py-2.5 font-medium">Project</th>
              <th className="px-5 py-2.5 font-medium">Stage</th>
              <th className="w-44 px-5 py-2.5 font-medium">Progress</th>
              <th className="px-5 py-2.5 text-right font-medium">Contract</th>
              <th className="px-5 py-2.5 font-medium">Health</th>
              <th className="px-5 py-2.5 font-medium">Portal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {rows.map(({ project: p, status }) => (
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
                    {p.clientName} · {p.buildsuiteProjectId}
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
                  {moneyLabel(p, currency)}
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
          {rows.map(({ project: p, status }) => (
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
                  {moneyLabel(p, currency)}
                  {p.estimatedCompletionDate !== '' &&
                    ` · due ${shortDate(p.estimatedCompletionDate)}`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
