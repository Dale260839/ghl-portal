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
import { Card, currency, shortDate } from '@/components/ui';
import {
  IconBudget,
  IconChangeOrders,
  IconIssues,
  IconProjects,
  IconUpdates,
} from '@/components/nav-icons';

/**
 * Portfolio Dashboard — the contractor's landing screen, built to the Project
 * Hub design: four company-metric tiles with a corner glyph, an active-projects
 * overview as health cards with progress, a titled Needs-Attention column, and
 * a recent-activity feed. Every figure is real; the money tiles say so when
 * BuildSuite holds a band rather than an amount.
 */

type Tone = 'good' | 'warn' | 'bad';

// BuildSuite ids are UUIDs; the fixtures use short codes. Show the short form
// so a long id never crowds the project name off its line.
function shortId(id: string): string {
  return id.length > 16 ? id.slice(0, 8) : id;
}

function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const cls =
    tone === 'good'
      ? 'bg-emerald-50 text-emerald-700'
      : tone === 'bad'
        ? 'bg-red-50 text-red-700'
        : 'bg-amber-soft text-amber-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

const CalendarGlyph = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 2v4M16 2v4M3 10h18" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
  </svg>
);

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

  const openChangeOrders = CHANGE_ORDERS.filter(
    (c) => activeIds.has(c.projectId) && (c.status === 'Draft' || c.status === 'Awaiting Client'),
  );
  const coPending = openChangeOrders
    .filter((c) => c.status === 'Awaiting Client')
    .reduce((sum, c) => sum + c.addedCost + c.tax - c.creditAmount, 0);

  // Status a homeowner action outranks a health flag — "Waiting on Client" is
  // what the mockup shows on the row that needs their sign-off.
  const statusFor = (p: (typeof active)[number]): { label: string; tone: Tone } => {
    if (p.clientActionRequired) return { label: 'Waiting on Client', tone: 'warn' };
    if (p.healthStatus === 'Delayed' || p.healthStatus === 'At Risk')
      return { label: p.healthStatus, tone: 'bad' };
    if (p.healthStatus === 'Attention Needed') return { label: p.healthStatus, tone: 'warn' };
    if (p.healthStatus === 'On Hold') return { label: p.healthStatus, tone: 'warn' };
    return { label: 'On Track', tone: 'good' };
  };

  // Recent activity: real updates and approved change orders, newest first.
  // Null for a project this tenant no longer has (deleted, or another owner's),
  // so the feed never prints a bare id where a name should be.
  const nameOf = (pid: string): string | null =>
    projects.find((p) => p.buildsuiteProjectId === pid)?.projectName ?? null;
  const activity = [
    ...updates.map((u) => ({
      id: u.id,
      date: u.updateDate,
      icon: IconUpdates,
      who: u.submittedBy,
      what:
        u.managerApprovalStatus === 'Approved & Published'
          ? 'published a client update'
          : 'logged a field update',
      where: nameOf(u.projectId),
    })),
    ...CHANGE_ORDERS.filter((c) => activeIds.has(c.projectId) && c.status === 'Approved').map(
      (c) => ({
        id: c.id,
        date: c.approvalDate !== '' ? c.approvalDate : c.createdDate,
        icon: IconChangeOrders,
        who: c.approvedBy !== '' ? c.approvedBy : c.requestedBy,
        what: `approved ${c.changeOrderNumber}`,
        where: nameOf(c.projectId),
      }),
    ),
  ]
    .filter((a) => a.where !== null)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  const tiles = [
    { label: 'Active Projects', value: String(active.length), sub: 'currently in progress', icon: IconProjects, bad: false },
    { label: 'At Risk / Delayed', value: String(atRisk.length), sub: atRisk.length > 0 ? 'Requires attention' : 'all on track', icon: IconIssues, bad: atRisk.length > 0 },
    { label: 'Open Change Orders', value: String(openChangeOrders.length), sub: coPending > 0 ? `${currency(coPending)} pending` : 'none pending', icon: IconChangeOrders, bad: false },
    { label: 'Revenue Under Contract', value: money ? currency(contractValue) : '—', sub: money ? `${currency(outstanding)} remaining` : 'not held in BuildSuite', icon: IconBudget, bad: false },
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div className="text-sm font-medium text-navy-600">{t.label}</div>
              <span className={t.bad ? 'text-red-500' : 'text-navy-300'}>{t.icon}</span>
            </div>
            <div className="tabular mt-2 text-3xl font-semibold text-navy-900">{t.value}</div>
            <div className={`mt-0.5 text-xs ${t.bad ? 'font-medium text-red-600' : 'text-navy-400'}`}>
              {t.sub}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-navy-900">Active Projects Overview</h2>
              <p className="mt-0.5 text-xs text-navy-400">
                Track health and progress across all ongoing jobs.
              </p>
            </div>
            <Link
              href="/dashboard/projects"
              className="inline-flex items-center gap-1 text-sm font-medium text-navy-600 hover:underline"
            >
              View All →
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {active.length === 0 && (
              <Card className="px-5 py-10 text-center text-sm text-navy-400">
                No active projects right now.
              </Card>
            )}
            {active.slice(0, 6).map((p) => {
              const st = statusFor(p);
              return (
                <Card key={p.buildsuiteProjectId} className="px-5 py-4">
                  <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[1.8fr_1fr_auto_auto]">
                    <div className="min-w-0">
                      <div className="flex items-start gap-2">
                        <Link
                          href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                          className="text-sm font-semibold text-navy-900 hover:underline"
                        >
                          {p.projectName}
                        </Link>
                        <span className="mt-0.5 shrink-0 text-[11px] text-navy-400">
                          {shortId(p.buildsuiteProjectId)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-navy-400">
                        {p.clientName}
                        {p.projectManager !== '' ? ` · PM: ${p.projectManager}` : ''}
                      </div>
                    </div>

                    <div className="min-w-0">
                      {hasOperationalDetail(p) ? (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="tracking-wide text-navy-400 uppercase">Progress</span>
                            <span className="tabular font-medium text-navy-700">
                              {p.progressPercentage}%
                            </span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                            <div
                              className="h-full rounded-full bg-amber-accent"
                              style={{ width: `${Math.min(100, Math.max(0, p.progressPercentage))}%` }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-navy-400">{stageLabel(p)}</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-1.5">
                      <StatusPill label={st.label} tone={st.tone} />
                      <span className="inline-flex items-center gap-1.5 text-xs text-navy-400">
                        <span className="text-navy-300">{CalendarGlyph}</span>
                        {p.nextMilestone}
                      </span>
                    </div>

                    <button
                      type="button"
                      aria-label="Project actions"
                      className="hidden h-8 w-8 items-center justify-center justify-self-end rounded-md text-navy-400 transition hover:bg-navy-50 hover:text-navy-700 sm:flex"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="12" cy="19" r="1.6" />
                      </svg>
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Needs Attention</h2>
            <p className="mt-0.5 text-xs text-navy-400">Items requiring immediate action.</p>
            <div className="mt-4 space-y-3">
              {atRisk.length === 0 && clientWaiting.length === 0 && pendingReview.length === 0 && (
                <Card className="px-5 py-6 text-center text-sm text-navy-400">
                  Nothing needs you right now.
                </Card>
              )}
              {atRisk.slice(0, 2).map((p) => (
                <Link
                  key={p.buildsuiteProjectId}
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="flex gap-3 rounded-lg border border-red-100 bg-red-50/50 px-4 py-3 transition hover:bg-red-50"
                >
                  <span className="mt-0.5 shrink-0 text-red-500">{IconIssues}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-red-700">{p.healthStatus}</div>
                    <div className="mt-0.5 text-xs text-navy-600">
                      {p.projectName}
                      {p.delayReason !== '' ? ` — ${p.delayReason}` : ''}
                    </div>
                    <div className="mt-1 text-xs font-medium text-red-700">Resolve issue →</div>
                  </div>
                </Link>
              ))}
              {clientWaiting.slice(0, 2).map((p) => (
                <Link
                  key={p.buildsuiteProjectId}
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="flex gap-3 rounded-lg border border-amber-accent/25 bg-amber-soft px-4 py-3 transition hover:brightness-[0.99]"
                >
                  <span className="mt-0.5 shrink-0 text-amber-accent">{IconUpdates}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-amber-700">Client Approval Overdue</div>
                    <div className="mt-0.5 text-xs text-navy-600">{p.projectName}</div>
                    <div className="mt-1 text-xs font-medium text-amber-700">Send reminder →</div>
                  </div>
                </Link>
              ))}
              {pendingReview.length > 0 && (
                <Link
                  href="/dashboard/updates"
                  className="flex gap-3 rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3 transition hover:bg-navy-50"
                >
                  <span className="mt-0.5 shrink-0 text-navy-400">{IconUpdates}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-navy-900">
                      {pendingReview.length} update{pendingReview.length === 1 ? '' : 's'} to review
                    </div>
                    <div className="mt-0.5 text-xs text-navy-600">Field submissions awaiting sign-off</div>
                    <div className="mt-1 text-xs font-medium text-navy-700">Open review queue →</div>
                  </div>
                </Link>
              )}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-navy-900">Recent Activity</h2>
            <Card className="mt-4">
              <ul className="divide-y divide-navy-100">
                {activity.length === 0 && (
                  <li className="px-5 py-8 text-center text-sm text-navy-400">No activity yet.</li>
                )}
                {activity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-500">
                      {a.icon}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-navy-800">
                        <span className="font-medium text-navy-900">{a.who}</span> {a.what}
                      </div>
                      <div className="mt-0.5 text-xs text-navy-400">
                        {a.where} · {shortDate(a.date)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
