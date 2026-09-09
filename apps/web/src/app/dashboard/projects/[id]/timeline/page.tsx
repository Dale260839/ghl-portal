import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Badge, Card, CardHeader } from '@/components/ui';
import { shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';
import { archiveMilestone, createMilestone, updateMilestone } from '@/lib/actions';

/** The four §6.2 states. Free text in the column, a list here. */
const MILESTONE_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Blocked'] as const;
const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

/**
 * Timeline — contractor control side of the client's Project Timeline.
 *
 * Chris's rule: the contractor sets the timeline, and the client only sees it
 * once it's released. So this is the full milestone list, each marked with
 * whether the client can see it; the client's tracker is a read of the same
 * milestones through the gate.
 */
export default async function ProjectTimelineControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const milestones = (await db.listMilestones(scope, id)).sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Timeline"
        subtitle="You set the milestones. The client sees the timeline once you release it."
        clientHref={`/portal/timeline?preview=${id}`}
      />

      <ControlNote>
        Stage moves come from GoHighLevel, which owns the pipeline; the milestone detail lives in
        the Hub. Toggling a milestone client-visible is what puts it on the homeowner&rsquo;s
        tracker.
      </ControlNote>

      <Card>
        <CardHeader title="Add milestone" />
        <form action={createMilestone} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <input type="hidden" name="projectId" value={id} />
          <input
            name="milestoneName"
            required
            placeholder="Milestone, e.g. Rough-in complete"
            className={`${FIELD} sm:col-span-2`}
          />
          <input
            name="sequence"
            type="number"
            min="0"
            defaultValue={milestones.length + 1}
            placeholder="Order"
            className={FIELD}
          />
          <button
            type="submit"
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
          >
            Add
          </button>
          <label className="text-xs text-navy-500 sm:col-span-2">
            Planned start
            <input type="date" name="plannedStart" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="text-xs text-navy-500 sm:col-span-2">
            Planned end
            <input type="date" name="plannedEnd" className={`${FIELD} mt-1 w-full`} />
          </label>
          <p className="text-xs text-navy-400 sm:col-span-4">
            Saved internal. Release it to the homeowner with the switch on the milestone.
          </p>
        </form>
      </Card>

      {milestones.length === 0 ? (
        <ControlEmpty title="No milestones yet" body="Add the first milestone to start the timeline." />
      ) : (
        <Card>
          <ol className="divide-y divide-navy-100">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-start gap-3.5 px-5 py-4">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                    m.status === 'Completed'
                      ? 'bg-emerald-500'
                      : m.status === 'In Progress'
                        ? 'bg-amber-accent'
                        : m.status === 'Blocked'
                          ? 'bg-red-500'
                          : 'bg-navy-200'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-navy-900">{m.milestoneName}</span>
                    <Badge
                      tone={
                        m.status === 'Completed'
                          ? 'good'
                          : m.status === 'In Progress'
                            ? 'warn'
                            : m.status === 'Blocked'
                              ? 'bad'
                              : 'neutral'
                      }
                    >
                      {m.status}
                    </Badge>
                    <VisibilityTag shown={m.clientVisible} />
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {shortDate(m.plannedStart)} → {shortDate(m.plannedEnd)}
                  </div>

                  <form action={updateMilestone} className="mt-3 grid gap-2 sm:grid-cols-4">
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <input type="hidden" name="projectId" value={id} />
                    <input
                      name="milestoneName"
                      defaultValue={m.milestoneName}
                      required
                      className={`${FIELD} sm:col-span-2`}
                    />
                    <select name="status" defaultValue={m.status} className={FIELD}>
                      {MILESTONE_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                    <input
                      name="sequence"
                      type="number"
                      min="0"
                      defaultValue={m.sequence}
                      className={FIELD}
                    />
                    <input
                      type="date"
                      name="plannedStart"
                      defaultValue={m.plannedStart?.slice(0, 10) ?? ''}
                      className={`${FIELD} sm:col-span-2`}
                    />
                    <input
                      type="date"
                      name="plannedEnd"
                      defaultValue={m.plannedEnd?.slice(0, 10) ?? ''}
                      className={`${FIELD} sm:col-span-2`}
                    />
                    <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
                      <label className="flex items-center gap-2 text-xs text-navy-600">
                        <input
                          type="checkbox"
                          name="clientVisible"
                          defaultChecked={m.clientVisible}
                          className="rounded border-navy-300"
                        />
                        Show this milestone to the client
                      </label>
                      <button
                        type="submit"
                        className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                      >
                        Save
                      </button>
                    </div>
                  </form>

                  <form action={archiveMilestone} className="mt-2">
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <input type="hidden" name="projectId" value={id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-red-700 transition hover:underline"
                    >
                      Remove milestone
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
