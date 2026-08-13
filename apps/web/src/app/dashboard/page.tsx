import Link from 'next/link';
import { getDataSource } from '@/lib/data/source';
import { requireTenantScope } from '@/lib/scope';
import {
  Card,
  CardHeader,
  HealthBadge,
  ProgressBar,
  StatTile,
  currency,
  shortDate,
} from '@/components/ui';

export default async function PortfolioOverview() {
  const scope = await requireTenantScope();
  const db = getDataSource(scope);
  const [projects, updates] = await Promise.all([db.listProjects(scope), db.listDailyUpdates(scope)]);

  const active = projects.filter(
    (p) => p.projectStage !== 'Completed' && p.projectStage !== 'Canceled',
  );
  const contractValue = active.reduce((sum, p) => sum + p.currentProjectTotal, 0);
  const outstanding = active.reduce((sum, p) => sum + p.remainingBalance, 0);
  const needsAttention = active.filter(
    (p) => p.healthStatus === 'At Risk' || p.healthStatus === 'Attention Needed',
  );
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending');
  const clientWaiting = active.filter((p) => p.clientActionRequired);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Portfolio Overview</h1>
        <p className="mt-1 text-sm text-navy-400">
          {active.length} active projects · Alliance Pro Services
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Active contract value"
          value={currency(contractValue)}
          sub={`across ${active.length} projects`}
        />
        <StatTile
          label="Outstanding balance"
          value={currency(outstanding)}
          sub="invoiced and unbilled"
        />
        <StatTile
          label="Updates awaiting review"
          value={String(pendingReview.length)}
          sub="field submissions"
          tone={pendingReview.length > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Needs attention"
          value={String(needsAttention.length)}
          sub="at risk or flagged"
          tone={needsAttention.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Projects needing attention"
            action={
              <Link href="/dashboard/projects" className="text-xs font-medium text-navy-600 hover:underline">
                View all
              </Link>
            }
          />
          <ul className="divide-y divide-navy-100">
            {needsAttention.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-navy-400">
                Every active project is on track.
              </li>
            )}
            {needsAttention.map((p) => (
              <li key={p.buildsuiteProjectId}>
                <Link
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="block px-5 py-4 transition hover:bg-navy-50/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-navy-900">
                        {p.projectName}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-navy-400">
                        {p.clientName} · {p.projectStage}
                      </div>
                    </div>
                    <HealthBadge status={p.healthStatus} />
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={p.progressPercentage} />
                  </div>
                  {p.delayReason !== '' && (
                    <div className="mt-2.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                      <span className="font-semibold">Internal · </span>
                      {p.delayReason}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Review queue"
              action={
                <Link href="/dashboard/updates" className="text-xs font-medium text-navy-600 hover:underline">
                  Review
                </Link>
              }
            />
            <ul className="divide-y divide-navy-100">
              {pendingReview.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-navy-400">Queue is clear.</li>
              )}
              {pendingReview.map((u) => {
                const project = projects.find((p) => p.buildsuiteProjectId === u.projectId);
                return (
                  <li key={u.id} className="px-5 py-3.5">
                    <div className="truncate text-sm font-medium text-navy-900">
                      {project?.projectName ?? u.projectId}
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {u.submittedBy} · {shortDate(u.updateDate)}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Waiting on the client" />
            <ul className="divide-y divide-navy-100">
              {clientWaiting.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-navy-400">
                  No outstanding client actions.
                </li>
              )}
              {clientWaiting.map((p) => (
                <li key={p.buildsuiteProjectId} className="px-5 py-3.5">
                  <div className="truncate text-sm font-medium text-navy-900">{p.projectName}</div>
                  <div className="mt-0.5 text-xs text-navy-400">{p.clientName}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
