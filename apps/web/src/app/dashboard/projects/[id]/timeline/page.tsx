import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Badge, Card } from '@/components/ui';
import { shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

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
        action={<ControlButton>Add milestone</ControlButton>}
      />

      <ControlNote>
        Stage moves come from GoHighLevel, which owns the pipeline; the milestone detail lives in
        the Hub. Toggling a milestone client-visible is what puts it on the homeowner&rsquo;s
        tracker.
      </ControlNote>

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
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
                >
                  Edit
                </button>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
