import { submitFieldUpdate } from '@/lib/actions';
import { getDataSource } from '@/lib/data/source';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';

/**
 * Field Interface (§12.2). Mobile-first, large tap targets, minimal typing.
 *
 * The rule this screen exists to enforce: the update form ends in TWO separate
 * text areas — Internal Field Notes and Suggested Client Progress Summary — and
 * there is no publish button anywhere on it. Submitting sends the update to the
 * PM (WF3) and notifies nobody else.
 */
export default async function FieldToday({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { submitted } = await searchParams;
  const db = getDataSource();
  const [projects, tasks] = await Promise.all([db.listProjects(), db.listTasks()]);

  // §12.2 / §9.4 — a field user sees only assigned projects. Fixtures assign by
  // superintendent; with live data this filters on the project's Field Team.
  const assigned = projects.filter((p) => p.superintendent === 'Tony Alvarez');
  const assignedIds = new Set(assigned.map((p) => p.buildsuiteProjectId));
  const todaysTasks = tasks.filter((t) => assignedIds.has(t.projectId));

  return (
    <div className="space-y-5">
      {submitted === '1' && (
        <div className="rounded-lg border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Update submitted to your project manager for review.
        </div>
      )}

      <Card>
        <CardHeader title="Today's tasks" />
        <ul className="divide-y divide-navy-100">
          {todaysTasks.map((t) => {
            const project = projects.find((p) => p.buildsuiteProjectId === t.projectId);
            return (
              <li key={t.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-navy-900">{t.taskName}</div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {project?.projectName} · {t.assignedTrade}
                    </div>
                  </div>
                  <Badge
                    tone={
                      t.status === 'In Progress'
                        ? 'warn'
                        : t.status === 'Ready for Review'
                          ? 'good'
                          : 'neutral'
                    }
                  >
                    {t.status}
                  </Badge>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm font-medium text-navy-700"
                  >
                    Complete
                  </button>
                </div>
              </li>
            );
          })}
          {todaysTasks.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-navy-400">Nothing scheduled today.</li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Add daily update" />
        <form action={submitFieldUpdate} className="space-y-4 px-4 py-4">
          <div>
            <label htmlFor="projectId" className="text-xs font-medium text-navy-600">
              Project
            </label>
            <select
              id="projectId"
              name="projectId"
              className="mt-1.5 w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm"
            >
              {assigned.map((p) => (
                <option key={p.buildsuiteProjectId} value={p.buildsuiteProjectId}>
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="workCompleted" className="text-xs font-medium text-navy-600">
              Work completed
            </label>
            <textarea
              id="workCompleted"
              name="workCompleted"
              rows={2}
              required
              className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label htmlFor="crewOnsite" className="text-xs font-medium text-navy-600">
                Crew
              </label>
              <input
                id="crewOnsite"
                name="crewOnsite"
                type="number"
                min={0}
                defaultValue={2}
                className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="hoursWorked" className="text-xs font-medium text-navy-600">
                Hours
              </label>
              <input
                id="hoursWorked"
                name="hoursWorked"
                type="number"
                min={0}
                step={0.5}
                defaultValue={8}
                className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
              />
            </div>
            <div>
              <label htmlFor="weather" className="text-xs font-medium text-navy-600">
                Weather
              </label>
              <input
                id="weather"
                name="weather"
                defaultValue="Clear"
                className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label htmlFor="blocker" className="text-xs font-medium text-navy-600">
              Blocker <span className="text-navy-400">(optional — raises an issue for your PM)</span>
            </label>
            <input
              id="blocker"
              name="blocker"
              placeholder="Anything stopping work?"
              className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm text-navy-700">
            <input
              type="checkbox"
              name="clientDecisionNeeded"
              className="h-4 w-4 accent-navy-600"
            />
            Client needs to decide something
          </label>

          {/* §12.2 — two separate areas. Only the second is a publish candidate. */}
          <div className="rounded-lg bg-red-50 px-3 py-3">
            <label htmlFor="internalNotes" className="text-xs font-semibold text-red-700">
              Internal field notes
            </label>
            <p className="mt-0.5 text-xs text-red-700/80">
              Your PM only. Never shown to the client.
            </p>
            <textarea
              id="internalNotes"
              name="internalNotes"
              rows={2}
              className="mt-2 w-full rounded-lg border border-red-200 bg-white px-3 py-2.5 text-sm"
            />
          </div>

          <div className="rounded-lg bg-navy-100/60 px-3 py-3">
            <label htmlFor="clientSummary" className="text-xs font-semibold text-navy-700">
              Suggested client progress summary
            </label>
            <p className="mt-0.5 text-xs text-navy-500">
              Your PM reviews and edits this before the client ever sees it.
            </p>
            <textarea
              id="clientSummary"
              name="clientSummary"
              rows={3}
              className="mt-2 w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm font-semibold text-white"
          >
            Submit to Project Manager
          </button>
          <p className="text-center text-xs text-navy-400">
            Submitting notifies your PM. It does not notify the client.
          </p>
        </form>
      </Card>

      <Card>
        <CardHeader title="My projects" />
        <ul className="divide-y divide-navy-100">
          {assigned.map((p) => (
            <li key={p.buildsuiteProjectId} className="px-4 py-3">
              <div className="text-sm font-medium text-navy-900">{p.projectName}</div>
              <div className="mt-0.5 text-xs text-navy-400">
                {p.projectStage} · updated {shortDate(p.lastUpdatedDate)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
