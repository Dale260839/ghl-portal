
import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, CardHeader, InternalOnly, StatTile, shortDate } from '@/components/ui';
import { currentDataSource } from '@/lib/data/current-source';

/**
 * Issues (§6.7) — where WF3's blockers and WF7's escalations land.
 *
 * Until now WF3 raised an issue on every reported blocker and nothing displayed
 * it, which is worse than not raising one: the field user is told it was logged
 * and the PM never sees it.
 *
 * Contractor-facing, so internal notes ARE shown — flagged, next to the
 * `Client Update` that is the client-safe counterpart. Seeing the two side by
 * side is what makes the distinction obvious to whoever writes them.
 */
export default async function Issues() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [issues, projects] = await Promise.all([db.listIssues(scope), db.listProjects(scope)]);

  const open = issues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed');
  const urgent = open.filter((i) => i.priority === 'Urgent');
  const unassigned = open.filter((i) => i.assignedTo === null);

  const nameOf = (projectId: string) =>
    projects.find((p) => p.buildsuiteProjectId === projectId)?.projectName ?? projectId;

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Issues</h1>
        <p className="mt-1 text-sm text-navy-400">
          {open.length} open across your projects
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Open" value={String(open.length)} />
        <StatTile
          label="Urgent"
          value={String(urgent.length)}
          sub="safety and escalated"
          tone={urgent.length > 0 ? 'warn' : 'good'}
        />
        <StatTile
          label="Unassigned"
          value={String(unassigned.length)}
          tone={unassigned.length > 0 ? 'warn' : 'good'}
        />
      </div>

      <Card>
        <CardHeader title="Open issues" />
        <ul className="divide-y divide-navy-100">
          {open.map((issue) => (
            <li key={issue.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-xs font-medium text-navy-400">
                      {issue.issueNumber}
                    </span>
                    <span className="text-sm font-medium text-navy-900">{issue.issueTitle}</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-navy-400">
                    {nameOf(issue.projectId)} · {issue.projectArea}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={issue.priority === 'Urgent' ? 'bad' : 'neutral'}>
                    {issue.priority}
                  </Badge>
                  <Badge>{issue.category}</Badge>
                  <Badge tone={issue.status === 'In Progress' ? 'warn' : 'neutral'}>
                    {issue.status}
                  </Badge>
                </div>
              </div>

              <p className="mt-2.5 text-sm text-navy-700">{issue.description}</p>

              <div className="mt-3 grid gap-2.5 md:grid-cols-2">
                <div className="rounded-md bg-red-50 px-3 py-2">
                  <InternalOnly>
                    <span className="text-xs font-semibold tracking-wide text-red-700 uppercase">
                      Internal notes
                    </span>
                  </InternalOnly>
                  <p className="mt-1 text-xs text-red-800">{issue.internalNotes}</p>
                </div>
                <div className="rounded-md bg-navy-100/60 px-3 py-2">
                  <span className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                    Client update
                  </span>
                  <p className="mt-1 text-xs text-navy-700">
                    {issue.clientUpdate === '' ? (
                      <span className="text-navy-400">
                        Nothing written yet — the client sees nothing about this issue.
                      </span>
                    ) : (
                      issue.clientUpdate
                    )}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
                <span>reported by {issue.reportedBy}</span>
                <span>{shortDate(issue.submittedDate)}</span>
                <span>{issue.assignedTo === null ? 'unassigned' : `assigned to ${issue.assignedTo}`}</span>
                {issue.targetResolutionDate !== null && (
                  <span>target {shortDate(issue.targetResolutionDate)}</span>
                )}
              </div>
            </li>
          ))}
          {open.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-navy-400">
              No open issues. Blockers reported from the field appear here automatically.
            </li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Resolved" />
        <ul className="divide-y divide-navy-100">
          {issues
            .filter((i) => i.status === 'Resolved' || i.status === 'Closed')
            .map((issue) => (
              <li key={issue.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-navy-900">
                    <span className="tabular mr-2 text-xs text-navy-400">{issue.issueNumber}</span>
                    {issue.issueTitle}
                  </span>
                  <Badge tone="good">{issue.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-navy-400">
                  {nameOf(issue.projectId)} · {issue.resolution}
                </p>
              </li>
            ))}
          {issues.every((i) => i.status !== 'Resolved' && i.status !== 'Closed') && (
            <li className="px-5 py-8 text-center text-sm text-navy-400">Nothing resolved yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
