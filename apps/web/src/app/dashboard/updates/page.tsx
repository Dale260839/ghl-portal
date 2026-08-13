import { reviewUpdate } from '@/lib/actions';
import { getDataSource } from '@/lib/data/source';
import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, CardHeader, InternalOnly, shortDate } from '@/components/ui';

/**
 * Daily Update Review (§12.1). The seven verbatim actions, and the one rule
 * that matters: `Internal Notes` and `Client Summary` are separate fields, and
 * only the second is ever a publish candidate (§10, §12.2).
 */
export default async function ReviewQueue() {
  const scope = await requireTenantScope();
  const db = getDataSource(scope);
  const [updates, projects] = await Promise.all([db.listDailyUpdates(scope), db.listProjects(scope)]);

  const queue = updates.filter(
    (u) => u.managerApprovalStatus === 'Pending' || u.managerApprovalStatus === 'Approved Internally',
  );
  const published = updates.filter((u) => u.managerApprovalStatus === 'Approved & Published');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Field Updates</h1>
        <p className="mt-1 text-sm text-navy-400">
          {queue.length} awaiting review · nothing reaches the client until you publish it
        </p>
      </div>

      <div className="space-y-5">
        {queue.map((u) => {
          const project = projects.find((p) => p.buildsuiteProjectId === u.projectId);
          return (
            <Card key={u.id}>
              <CardHeader
                title={project?.projectName ?? u.projectId}
                action={
                  <Badge tone={u.managerApprovalStatus === 'Pending' ? 'warn' : 'neutral'}>
                    {u.managerApprovalStatus}
                  </Badge>
                }
              />
              <div className="space-y-4 px-5 py-4">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
                  <span>{u.submittedBy}</span>
                  <span>{shortDate(u.updateDate)}</span>
                  <span>{u.crewOnsite} crew onsite</span>
                  <span>{u.hoursWorked} hrs</span>
                  <span>{u.weather}</span>
                </div>

                <div>
                  <div className="text-xs font-semibold tracking-wide text-navy-400 uppercase">
                    Work completed
                  </div>
                  <p className="mt-1 text-sm text-navy-700">{u.workCompleted}</p>
                </div>

                <div className="rounded-lg bg-red-50 px-4 py-3">
                  <InternalOnly>
                    <span className="text-xs font-semibold tracking-wide text-red-700 uppercase">
                      Internal field notes
                    </span>
                  </InternalOnly>
                  <p className="mt-1.5 text-sm text-red-800">{u.internalNotes}</p>
                  <p className="mt-2 text-xs text-red-700/80">
                    Cannot be published. Not readable from any client-facing response.
                  </p>
                </div>

                <form action={reviewUpdate} className="space-y-3">
                  <input type="hidden" name="updateId" value={u.id} />
                  <div>
                    <label
                      htmlFor={`summary-${u.id}`}
                      className="text-xs font-semibold tracking-wide text-navy-400 uppercase"
                    >
                      Client summary — editable before publishing
                    </label>
                    <textarea
                      id={`summary-${u.id}`}
                      name="clientSummary"
                      rows={3}
                      defaultValue={u.clientSummary}
                      className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 focus:border-navy-600 focus:ring-1 focus:ring-navy-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      name="action"
                      value="publish"
                      className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                    >
                      Approve and Publish
                    </button>
                    <button
                      type="submit"
                      name="action"
                      value="internal"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Approve Internally
                    </button>
                    <button
                      type="submit"
                      name="action"
                      value="save"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Edit Client Summary
                    </button>
                    <button
                      type="submit"
                      name="action"
                      value="return"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Return for Revision
                    </button>
                  </div>
                </form>
              </div>
            </Card>
          );
        })}

        {queue.length === 0 && (
          <Card className="px-5 py-12 text-center text-sm text-navy-400">
            Review queue is clear.
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Published to clients" />
        <ul className="divide-y divide-navy-100">
          {published.map((u) => {
            const project = projects.find((p) => p.buildsuiteProjectId === u.projectId);
            return (
              <li key={u.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-navy-900">
                    {project?.projectName ?? u.projectId}
                  </span>
                  <span className="text-xs text-navy-400">
                    published {u.publishDate === null ? '—' : shortDate(u.publishDate)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-navy-600">{u.clientSummary}</p>
              </li>
            );
          })}
          {published.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-navy-400">Nothing published yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
