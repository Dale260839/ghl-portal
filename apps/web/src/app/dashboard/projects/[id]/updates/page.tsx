import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Badge, Card, InternalNote, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Daily Updates — contractor control side. The field crew logs the day; the PM
 * reviews it, edits the client line, and publishes. The client reads only the
 * published summary — never the internal note underneath it.
 */
export default async function ProjectUpdatesControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const updates = (await db.listDailyUpdates(scope, id)).sort((a, b) =>
    b.updateDate.localeCompare(a.updateDate),
  );
  const pending = updates.filter((u) => u.managerApprovalStatus === 'Pending').length;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Daily Updates"
        subtitle="Review what the crew logged, edit the client line, publish. Internal notes stay internal."
        clientHref={`/portal/updates?preview=${id}`}
      />

      <ControlNote>
        {pending > 0 ? (
          <>
            <strong className="font-semibold text-navy-900">{pending}</strong> update
            {pending === 1 ? '' : 's'} waiting on your review. Nothing reaches the client until you
            approve and publish it.
          </>
        ) : (
          <>Everything logged has been reviewed. The client sees only published summaries.</>
        )}
      </ControlNote>

      {updates.length === 0 ? (
        <ControlEmpty title="No updates yet" body="Field updates for this project will land here." />
      ) : (
        <div className="space-y-3">
          {updates.map((u) => (
            <Card key={u.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-navy-900">
                  {shortDate(u.updateDate)} · {u.submittedBy}
                </span>
                <div className="flex flex-wrap items-center gap-2">
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
                  <VisibilityTag shown={project.clientPortalEnabled && u.clientVisible} />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
                <span>{u.crewOnsite} crew onsite</span>
                <span>{u.hoursWorked} hrs</span>
                <span>{u.weather}</span>
              </div>
              <p className="mt-2.5 text-sm text-navy-600">
                <span className="text-xs font-medium tracking-wide text-navy-400 uppercase">
                  Client summary
                </span>
                <br />
                {u.clientSummary}
              </p>
              <div className="mt-2.5">
                <InternalNote label="Internal notes" size="xs">
                  {u.internalNotes}
                </InternalNote>
              </div>
              {u.managerApprovalStatus === 'Pending' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                  >
                    Approve &amp; publish
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Edit client line
                  </button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
