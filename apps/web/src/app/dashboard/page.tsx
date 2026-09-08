import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { CHANGE_ORDERS } from '@/lib/data/portal-fixtures';
import {
  hasFinancials,
  hasOperationalDetail,
  isActiveProject,
  stageLabel,
} from '@/lib/data/types';
import { Card, HealthBadge, ProgressBar, currency, shortDate } from '@/components/ui';

/**
 * Portfolio Dashboard — the contractor's landing screen, built to match the
 * Project Hub design: four company-metric tiles, an active-projects overview
 * with health at a glance, what needs attention, and a recent-activity feed.
 *
 * Every figure is real — read from the projects and updates the tenant owns.
 * Where BuildSuite records a band rather than an amount, the money tiles say so
 * instead of totalling zeros.
 */
export default async function PortfolioDashboard() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, updates] = await Promise.all([
    db.listProjects(scope),
    db.listDailyUpdates(scope),
  ]);

  const active = projects.filter(isActiveProject);
  const activeIds = new Set(active.map((p) => p.buildsuiteProjectId));

  const money = active.some(hasFinancials);
  const contractValue = active.reduce((sum, p) => sum + p.currentProjectTotal, 0);
  const outstanding = active.reduce((sum, p) => sum + p.remainingBalance, 0);

  const atRisk = active.filter(
    (p) =>
      p.healthStatus === 'At Risk' ||
      p.healthStatus === 'Attention Needed' ||
      p.healthStatus === 'Delayed',
  );
  const clientWaiting = active.filter((p) => p.clientActionRequired);
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending');

  // Open change orders across active projects — drafts and ones out with the
  // client. Pending dollars is the net still awaiting a client decision.
  const openChangeOrders = CHANGE_ORDERS.filter(
    (c) => activeIds.has(c.projectId) && (c.status === 'Draft' || c.status === 'Awaiting Client'),
  );
  const coPending = openChangeOrders
    .filter((c) => c.status === 'Awaiting Client')
    .reduce((sum, c) => sum + c.addedCost + c.tax - c.creditAmount, 0);

  // A recent-activity feed from the real updates, newest first.
  const recent = [...updates]
    .sort((a, b) => b.updateDate.localeCompare(a.updateDate))
    .slice(0, 5)
    .map((u) => ({
      id: u.id,
      who: u.submittedBy,
      what:
        u.managerApprovalStatus === 'Approved & Published'
          ? 'published a client update'
          : 'logged a field update',
      where: projects.find((p) => p.buildsuiteProjectId === u.projectId)?.projectName ?? u.projectId,
      when: u.updateDate,
    }));

  const tiles = [
    {
      label: 'Active Projects',
      value: String(active.length),
      sub: 'currently in progress',
      tone: 'plain' as const,
    },
    {
      label: 'At Risk / Delayed',
      value: String(atRisk.length),
      sub: atRisk.length > 0 ? 'Requires attention' : 'all on track',
      tone: atRisk.length > 0 ? ('bad' as const) : ('plain' as const),
    },
    {
      label: 'Open Change Orders',
      value: String(openChangeOrders.length),
      sub: coPending > 0 ? `${currency(coPending)} pending` : 'none pending',
      tone: 'plain' as const,
    },
    {
      label: 'Revenue Under Contract',
      value: money ? currency(contractValue) : '—',
      sub: money ? `${currency(outstanding)} remaining` : 'not held in BuildSuite',
      tone: 'plain' as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Portfolio Dashboard
          </h1>
          <p className="mt-1 text-sm text-navy-400">
            Overview of all active projects and company metrics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
          >
            Download Report
          </button>
          <button
            type="button"
            className="rounded-lg bg-amber-accent px-3.5 py-2 text-sm font-semibold text-white transition hover:brightness-95"
          >
            Create Project
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="px-5 py-4">
            <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">
              {t.label}
            </div>
            <div className="tabular mt-1.5 text-3xl font-semibold text-navy-900">{t.value}</div>
            <div
              className={`mt-0.5 text-xs ${t.tone === 'bad' ? 'font-medium text-red-600' : 'text-navy-400'}`}
            >
              {t.sub}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-navy-900">Active Projects Overview</h2>
              <p className="mt-0.5 text-xs text-navy-400">
                Track health and progress across all ongoing jobs.
              </p>
            </div>
            <Link
              href="/dashboard/projects"
              className="text-xs font-medium text-navy-600 hover:underline"
            >
              View All →
            </Link>
          </div>
          <ul className="divide-y divide-navy-100 border-t border-navy-100">
            {active.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-navy-400">
                No active projects right now.
              </li>
            )}
            {active.slice(0, 6).map((p) => (
              <li key={p.buildsuiteProjectId}>
                <Link
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="grid grid-cols-1 gap-3 px-5 py-4 transition hover:bg-navy-50/60 sm:grid-cols-[1.4fr_1.2fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-navy-900">
                        {p.projectName}
                      </span>
                      <span className="shrink-0 text-[11px] text-navy-400">
                        {p.buildsuiteProjectId}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {p.clientName}
                      {p.projectManager !== '' ? ` · PM: ${p.projectManager}` : ''}
                    </div>
                  </div>

                  <div className="min-w-0">
                    {hasOperationalDetail(p) ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] tracking-wide text-navy-400 uppercase">
                          Progress
                        </span>
                        <div className="min-w-0 flex-1">
                          <ProgressBar value={p.progressPercentage} />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-navy-400">{stageLabel(p)}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    {hasOperationalDetail(p) && <HealthBadge status={p.healthStatus} />}
                    <span className="truncate text-xs text-navy-400">{p.nextMilestone}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card>
            <div className="px-5 py-4">
              <h2 className="text-base font-semibold text-navy-900">Needs Attention</h2>
              <p className="mt-0.5 text-xs text-navy-400">Items requiring immediate action.</p>
            </div>
            <div className="space-y-3 px-5 pb-5">
              {atRisk.length === 0 && clientWaiting.length === 0 && pendingReview.length === 0 && (
                <p className="py-6 text-center text-sm text-navy-400">Nothing needs you right now.</p>
              )}
              {atRisk.slice(0, 2).map((p) => (
                <Link
                  key={p.buildsuiteProjectId}
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="block rounded-lg border border-red-100 bg-red-50/60 px-4 py-3 transition hover:bg-red-50"
                >
                  <div className="text-sm font-semibold text-red-700">{p.healthStatus}</div>
                  <div className="mt-0.5 text-xs text-navy-600">
                    {p.projectName}
                    {p.delayReason !== '' ? ` — ${p.delayReason}` : ''}
                  </div>
                  <div className="mt-1 text-xs font-medium text-red-700">Resolve issue →</div>
                </Link>
              ))}
              {clientWaiting.slice(0, 2).map((p) => (
                <Link
                  key={p.buildsuiteProjectId}
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="block rounded-lg border border-amber-accent/25 bg-amber-soft px-4 py-3 transition hover:brightness-[0.99]"
                >
                  <div className="text-sm font-semibold text-amber-700">Waiting on client</div>
                  <div className="mt-0.5 text-xs text-navy-600">{p.projectName}</div>
                  <div className="mt-1 text-xs font-medium text-amber-700">Send reminder →</div>
                </Link>
              ))}
              {pendingReview.length > 0 && (
                <Link
                  href="/dashboard/updates"
                  className="block rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3 transition hover:bg-navy-50"
                >
                  <div className="text-sm font-semibold text-navy-900">
                    {pendingReview.length} update{pendingReview.length === 1 ? '' : 's'} to review
                  </div>
                  <div className="mt-0.5 text-xs text-navy-600">Field submissions awaiting sign-off</div>
                  <div className="mt-1 text-xs font-medium text-navy-700">Open review queue →</div>
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <div className="px-5 py-4">
              <h2 className="text-base font-semibold text-navy-900">Recent Activity</h2>
            </div>
            <ul className="divide-y divide-navy-100 border-t border-navy-100">
              {recent.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-navy-400">No activity yet.</li>
              )}
              {recent.map((r) => (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="text-sm text-navy-800">
                    <span className="font-medium text-navy-900">{r.who}</span> {r.what}
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {r.where} · {shortDate(r.when)}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
