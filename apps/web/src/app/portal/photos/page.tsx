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

  const photos = await photosFor(project);

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
          {photos.map((p) => {
            // Served by row id, so the §9.1 gates decide — a homeowner holds no
            // tenant scope and the path route could never answer them.
            const href = p.externalUrl ?? `/api/files?id=${encodeURIComponent(p.id)}&kind=photo`;
            return (
              <Card key={p.id} className="overflow-hidden">
                <a href={href} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={href}
                    alt={p.label === '' ? 'Progress photo' : p.label}
                    loading="lazy"
                    className="h-44 w-full bg-navy-50 object-cover"
                  />
                </a>
                <div className="px-4 py-3">
                  <div className="text-sm font-medium text-navy-900">{p.label}</div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {shortDate((p.createdAt ?? '').slice(0, 10))}
                    {p.category !== '' && ` · ${p.category}`}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
