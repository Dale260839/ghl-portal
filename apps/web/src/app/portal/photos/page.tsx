import { currentPortalProject, photosFor } from '@/lib/portal-data';
import { Card, PortalEmpty, shortDate } from '@/components/ui';

export default async function PortalPhotos({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const photos = photosFor(project);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Photos &amp; Videos</h1>
        <p className="mt-1 text-sm text-navy-400">
          Progress photos from the field, published with your updates.
        </p>
      </div>

      {photos.length === 0 ? (
        <PortalEmpty
          title="No photos yet"
          body="Photos appear here as your contractor publishes them with daily updates."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <div className="flex h-44 items-center justify-center bg-navy-50 text-xs text-navy-400">
                {/* Real images arrive with hub_photos and storage. */}
                Photo
              </div>
              <div className="px-4 py-3">
                <div className="text-sm font-medium text-navy-900">{p.caption}</div>
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
