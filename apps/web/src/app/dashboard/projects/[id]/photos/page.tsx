import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { PHOTOS } from '@/lib/data/portal-fixtures';
import { Card, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Photos & Videos — contractor control side. Field media, sourced from daily
 * updates and completed tasks. The contractor decides which shots the client
 * sees; the rest stay internal.
 */
export default async function ProjectPhotosControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const photos = PHOTOS.filter((p) => p.projectId === id).sort((a, b) =>
    b.takenDate.localeCompare(a.takenDate),
  );

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Photos & Videos"
        subtitle="Field media from updates and tasks. Choose what the client sees."
        clientHref={`/portal/photos?preview=${id}`}
        action={<ControlButton>Add media</ControlButton>}
      />

      <ControlNote>
        Photos come off the daily updates and completed tasks. Mark the ones worth showing the
        client; progress shots you would rather not share stay on your side.
      </ControlNote>

      {photos.length === 0 ? (
        <ControlEmpty title="No media yet" body="Photos and videos for this project will land here." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex aspect-video items-center justify-center bg-navy-100 text-xs text-navy-400">
                {/* Field media is not wired to storage yet — the tile stands in for the asset. */}
                {p.caption}
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-navy-900">{p.caption}</span>
                  <VisibilityTag shown={project.clientPortalEnabled && p.clientVisible} />
                </div>
                <div className="mt-0.5 text-xs text-navy-400">
                  {shortDate(p.takenDate)} · {p.sourceLabel}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
