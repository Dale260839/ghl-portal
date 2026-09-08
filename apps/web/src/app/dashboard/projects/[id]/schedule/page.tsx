import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { SCHEDULE_ITEMS } from '@/lib/data/portal-fixtures';
import { Badge, Card, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Schedule — contractor control side. The client can only view; the contractor
 * sets and publishes. So this lists every appointment on the project, including
 * ones not yet released, and the master switch state governs whether any of it
 * reaches the client at all.
 */
export default async function ProjectScheduleControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const items = SCHEDULE_ITEMS.filter((s) => s.projectId === id).sort((a, b) =>
    a.scheduledDate.localeCompare(b.scheduledDate),
  );
  const scheduleReleased = project.clientPortalEnabled && project.showScheduleToClient;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Schedule"
        subtitle="Set and publish the work dates. The client sees the schedule but cannot change it."
        clientHref={`/portal/schedule?preview=${id}`}
        action={<ControlButton>New appointment</ControlButton>}
      />

      <ControlNote>
        {scheduleReleased ? (
          <>
            The schedule is <strong className="font-semibold text-navy-900">published</strong> to
            this client. Individual appointments still follow their own client-visible flag.
          </>
        ) : (
          <>
            The schedule is <strong className="font-semibold text-navy-900">not published</strong>{' '}
            to this client. Turn on &ldquo;Show Schedule to Client&rdquo; under Visibility to release
            it.
          </>
        )}
      </ControlNote>

      {items.length === 0 ? (
        <ControlEmpty title="Nothing scheduled" body="Add the first appointment for this project." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-navy-900">{item.title}</span>
                    <Badge
                      tone={
                        item.status === 'Confirmed'
                          ? 'good'
                          : item.status === 'Tentative'
                            ? 'warn'
                            : 'neutral'
                      }
                    >
                      {item.status}
                    </Badge>
                    <VisibilityTag shown={scheduleReleased && item.clientVisible} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-400">
                    <span>{shortDate(item.scheduledDate)}</span>
                    <span>{item.timeWindow}</span>
                    <span>{item.crew}</span>
                    <span>{item.location}</span>
                  </div>
                  {item.clientNote !== '' && (
                    <div className="mt-2.5 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber-800">
                      Client note: {item.clientNote}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
                >
                  Edit
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
