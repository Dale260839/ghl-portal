import { currentPortalProject } from '@/lib/portal-data';
import { photosFor } from '@/lib/portal-gates';
import { groupByMonth, photoCount } from '@/lib/photo-groups';
import { Card, PortalEmpty, shortDate } from '@/components/ui';

/**
 * Photos & Videos, the homeowner's side.
 *
 * ---------------------------------------------------------------------------
 * GROUPED BY MONTH SINCE 2026-10-02
 *
 * This was one flat grid, newest first, with no dates between the tiles. That
 * reads well at twenty photographs; **one kitchen is four hundred**, and at
 * that size somebody looking for "the week the units went in" has no way to
 * find it. The grid becomes a wall.
 *
 * Months are the unit people actually remember a renovation in, and a month
 * heading with a count gives the thing a flat grid never does: a sense of how
 * much happened, and when.
 *
 * The release rule is unchanged and still lives in the read: `photosFor`
 * applies the portal switch, the Photos switch, and `client_visible` per row.
 * Nothing here filters, so nothing here can forget to.
 * ---------------------------------------------------------------------------
 */
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
  const months = groupByMonth(photos);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Photos &amp; Videos</h1>
        <p className="mt-1 text-sm text-navy-400">
          Progress photos from the field, published with your updates.
          {photos.length > 0 && <> · {photoCount(photos.length)}</>}
        </p>
      </div>

      {photos.length === 0 ? (
        <PortalEmpty
          title="No photos yet"
          body="Photos appear here as your contractor publishes them with daily updates."
        />
      ) : (
        months.map((month) => (
          <section key={month.key} className="space-y-3">
            {/* Sticky, so the month you are looking at stays named while you
                scroll a long one. On four hundred photographs the heading is
                the only thing telling you where you are. */}
            <h2 className="sticky top-0 z-10 flex items-baseline gap-2 bg-navy-50/95 py-2 text-sm font-semibold text-navy-900 backdrop-blur">
              {month.label}
              <span className="text-xs font-normal text-navy-400">
                {photoCount(month.items.length)}
              </span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {month.items.map((p) => {
                // Served by row id, so the §9.1 gates decide — a homeowner holds
                // no tenant scope and the path route could never answer them.
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
          </section>
        ))
      )}
    </div>
  );
}
