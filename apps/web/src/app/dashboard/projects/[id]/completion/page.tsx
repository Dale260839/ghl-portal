import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { PUNCH_LIST } from '@/lib/data/portal-fixtures';
import { punchListProgress } from '@/lib/data/types';
import { Badge, Card, InternalNote, ProgressBar, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Verified: 'good',
  Completed: 'good',
  Scheduled: 'warn',
  Open: 'neutral',
};

/**
 * Completion & Warranty — contractor control side. The punch list that closes
 * the project out. The contractor works the items and publishes the ones the
 * client should track; the internal note on each stays internal.
 */
export default async function ProjectCompletionControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const items = PUNCH_LIST.filter((p) => p.projectId === id).sort((a, b) =>
    a.itemNumber.localeCompare(b.itemNumber),
  );
  const progress = punchListProgress(items);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Completion & Warranty"
        subtitle="Close out the punch list. Publish the items the client should see."
        clientHref={`/portal/completion?preview=${id}`}
        action={<ControlButton>Add punch item</ControlButton>}
      />

      <ControlNote>
        Work the list down to zero. Items you publish appear on the client&rsquo;s closeout tracker;
        the internal note on each is yours.
      </ControlNote>

      {items.length === 0 ? (
        <ControlEmpty title="No punch list" body="Closeout items for this project will land here." />
      ) : (
        <>
          <Card className="px-5 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-navy-900">Closeout progress</span>
              <span className="tabular text-navy-500">
                {progress.done} of {progress.total} done · {progress.remaining} left
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar value={progress.percent} />
            </div>
          </Card>

          <div className="space-y-3">
            {items.map((p) => (
              <Card key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-900">
                        {p.itemNumber} · {p.title}
                      </span>
                      <Badge tone={TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      {p.raisedByClient && <Badge tone="warn">Client raised</Badge>}
                      <VisibilityTag shown={project.clientPortalEnabled && p.clientVisible} />
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {p.location} · reported by {p.reportedBy}
                      {p.targetDate !== '' ? ` · target ${shortDate(p.targetDate)}` : ''}
                    </div>
                  </div>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-navy-600">{p.description}</p>
                <div className="mt-2.5">
                  <InternalNote label="Internal notes" size="xs">
                    {p.internalNotes}
                  </InternalNote>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
