import { submitFieldUpdate } from '@/lib/actions';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getSession } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui';
import { assignedProjectIds, projectsForField } from '@/lib/field-data';

/**
 * The daily update form (§12.2).
 *
 * The rule this screen exists to enforce: it ends in TWO separate text areas —
 * Internal Field Notes and Suggested Client Progress Summary — and there is no
 * publish button anywhere on it. Submitting runs WF3, which notifies the PM and
 * nobody else.
 *
 * D4 §5: the superintendent *proposes* wording. They do not decide what the
 * homeowner reads.
 */
export default async function FieldUpdate() {
  const session = await getSession();
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  // Tasks decide which projects are this person's, so both are needed.
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  // §9.4 — only projects this person is on, and with every money field already
  // dropped by `projectsForField`.
  const assigned = projectsForField(projects, assignedProjectIds(tasks, session?.membershipId ?? ''));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Add daily update</h1>
        <p className="mt-1 text-sm text-navy-400">
          Goes to your PM for review. Nothing here reaches the client directly.
        </p>
      </div>

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
          <div className="rounded-lg border-l-2 border-amber-accent bg-amber-soft px-3 py-3">
            <label htmlFor="internalNotes" className="text-xs font-semibold text-amber-accent">
              Internal field notes
            </label>
            <p className="mt-0.5 text-xs text-amber-900/70">
              Your PM only. Never shown to the client.
            </p>
            <textarea
              id="internalNotes"
              name="internalNotes"
              rows={2}
              className="mt-2 w-full rounded-lg border border-amber-accent/30 bg-white px-3 py-2.5 text-sm"
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
    </div>
  );
}
