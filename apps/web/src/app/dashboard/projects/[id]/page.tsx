import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDataSource } from '@/lib/data/source';
import {
  Badge,
  Card,
  CardHeader,
  HealthBadge,
  InternalOnly,
  ProgressBar,
  currency,
  shortDate,
} from '@/components/ui';

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDataSource();
  const project = await db.getProject(id);
  if (project === null) notFound();

  const [milestones, updates, tasks] = await Promise.all([
    db.listMilestones(id),
    db.listDailyUpdates(id),
    db.listTasks(id),
  ]);

  const switches: [string, boolean][] = [
    ['Client Portal Enabled', project.clientPortalEnabled],
    ['Show Budget to Client', project.showBudgetToClient],
    ['Show Detailed Pricing', project.showDetailedPricing],
    ['Show Schedule to Client', project.showScheduleToClient],
    ['Show Assigned Team', project.showAssignedTeam],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/projects" className="text-xs font-medium text-navy-400 hover:underline">
          ← Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">
            {project.projectName}
          </h1>
          <HealthBadge status={project.healthStatus} />
        </div>
        <p className="mt-1 text-sm text-navy-400">
          {project.projectAddress} · {project.buildsuiteProjectId}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card className="px-5 py-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Stage</div>
                <div className="mt-1 text-sm font-medium text-navy-900">{project.projectStage}</div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Current</div>
                <div className="mt-1 text-sm font-medium text-navy-900">
                  {project.currentMilestone}
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Next</div>
                <div className="mt-1 text-sm font-medium text-navy-900">{project.nextMilestone}</div>
              </div>
            </div>
            <div className="mt-5">
              <ProgressBar value={project.progressPercentage} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" />
            <ol className="divide-y divide-navy-100">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-start gap-3.5 px-5 py-3.5">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      m.status === 'Completed'
                        ? 'bg-emerald-500'
                        : m.status === 'In Progress'
                          ? 'bg-amber-accent'
                          : 'bg-navy-200'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-900">{m.milestoneName}</span>
                      <Badge
                        tone={
                          m.status === 'Completed' ? 'good' : m.status === 'In Progress' ? 'warn' : 'neutral'
                        }
                      >
                        {m.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {shortDate(m.plannedStart)} → {shortDate(m.plannedEnd)}
                    </div>
                  </div>
                </li>
              ))}
              {milestones.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-navy-400">
                  No milestones seeded yet.
                </li>
              )}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title="Field updates"
              action={
                <Link href="/dashboard/updates" className="text-xs font-medium text-navy-600 hover:underline">
                  Review queue
                </Link>
              }
            />
            <ul className="divide-y divide-navy-100">
              {updates.map((u) => (
                <li key={u.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-navy-900">
                      {shortDate(u.updateDate)} · {u.submittedBy}
                    </span>
                    <Badge
                      tone={
                        u.managerApprovalStatus === 'Approved & Published'
                          ? 'good'
                          : u.managerApprovalStatus === 'Pending'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      {u.managerApprovalStatus}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-navy-600">{u.clientSummary}</p>
                  <div className="mt-2.5 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                    <InternalOnly>
                      <span className="font-semibold">Internal notes</span>
                    </InternalOnly>
                    <p className="mt-1">{u.internalNotes}</p>
                  </div>
                </li>
              ))}
              {updates.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-navy-400">No updates yet.</li>
              )}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Financials" />
            <dl className="divide-y divide-navy-100 text-sm">
              {[
                ['Contract Amount', currency(project.contractAmount), false],
                ['Approved Change Orders', currency(project.approvedChangeOrders), false],
                ['Pending Change Orders', currency(project.pendingChangeOrders), false],
                ['Current Project Total', currency(project.currentProjectTotal), false],
                ['Amount Invoiced', currency(project.amountInvoiced), false],
                ['Amount Paid', currency(project.amountPaid), false],
                ['Remaining Balance', currency(project.remainingBalance), false],
                ['Original Estimate', currency(project.originalEstimate), true],
                ['Markup', `${project.internalMarkup}%`, true],
                ['Margin', `${project.margin}%`, true],
              ].map(([label, value, internal]) => (
                <div key={label as string} className="flex items-center justify-between px-5 py-2.5">
                  <dt className="text-navy-600">
                    {internal ? <InternalOnly>{label}</InternalOnly> : label}
                  </dt>
                  <dd className="tabular font-medium text-navy-900">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="border-t border-navy-100 px-5 py-3 text-xs leading-relaxed text-navy-400">
              Fields marked internal are excluded from client responses at the data layer, not
              hidden in the UI.
            </p>
          </Card>

          <Card>
            <CardHeader title="Client visibility" />
            <ul className="divide-y divide-navy-100 text-sm">
              {switches.map(([label, on]) => (
                <li key={label} className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-navy-600">{label}</span>
                  {on ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
                </li>
              ))}
            </ul>
            <div className="border-t border-navy-100 px-5 py-3">
              <Link
                href={`/portal?preview=${project.buildsuiteProjectId}`}
                className="text-xs font-medium text-navy-600 hover:underline"
              >
                See what the client sees →
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title="Assigned team" />
            <dl className="divide-y divide-navy-100 text-sm">
              <div className="flex items-center justify-between px-5 py-2.5">
                <dt className="text-navy-600">Project Manager</dt>
                <dd className="font-medium text-navy-900">{project.projectManager}</dd>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <dt className="text-navy-600">Superintendent</dt>
                <dd className="font-medium text-navy-900">{project.superintendent}</dd>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <dt className="text-navy-600">Open tasks</dt>
                <dd className="font-medium text-navy-900">
                  {tasks.filter((t) => t.status !== 'Completed').length}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
