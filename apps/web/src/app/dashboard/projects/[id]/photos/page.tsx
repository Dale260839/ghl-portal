import { NotLinkedToContractor } from '@/components/not-linked';
import { getHubMedia } from '@/lib/hub-db/media';
import { MediaManager } from '@/components/media-manager';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { PHOTOS } from '@/lib/data/portal-fixtures';
import { Card, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

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

  // Nine of the sixty-eight accounts on this location do not resolve to a
  // contractor record, and everything the Hub stores is filed under one. Say
  // so rather than throwing: `assertContractor` is right to refuse, but a
  // TenancyError on screen tells the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Photos" />;
  }

  const hub = getHubMedia();
  const items = hub.available ? await hub.media.listForProject(scope, 'photo', id) : [];
  // No per-type switch exists for photos — the portal master is the only
  // project-level gate, and the row's own flag is the other half.
  const released = project.clientPortalEnabled && project.showPhotos;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Photos & Videos"
        subtitle="Field media from updates and tasks. Choose what the client sees."
        clientHref={`/portal/photos?preview=${id}`}
      />

      <ControlNote>
        Photos come off the daily updates and completed tasks. Mark the ones worth showing the
        client; progress shots you would rather not share stay on your side.
      </ControlNote>

      <MediaManager
        kind="photo"
        projectId={id}
        items={items}
        released={released}
        hub={hub.available ? { available: true, missing: [] } : { available: false, missing: hub.missing }}
      />
    </div>
  );
}
