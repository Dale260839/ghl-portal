import type { MediaItem } from '@/lib/hub-db/media';

/**
 * The photographs that came with an update.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT, TWO AUDIENCES, AND THE DIFFERENCE IS THE CALLER'S
 *
 * The PM sees every photo on the update they are reviewing, because they are
 * deciding which of them a homeowner may see. The homeowner sees the released
 * ones only — and that narrowing happens in the READ (`listForUpdates` takes
 * `clientVisibleOnly` as a required argument), not here.
 *
 * That is deliberate. A component that filtered its own props would put the
 * privacy rule in a template, where the next person to write a template does
 * not inherit it. The rule lives in the query; this only draws what it is
 * handed.
 *
 * `release` is what makes them different on screen: the PM's copy shows the
 * state of each photograph and a control; the homeowner's shows a photograph.
 * ---------------------------------------------------------------------------
 */
export function UpdatePhotos({
  photos,
  release,
}: {
  photos: MediaItem[];
  /** The PM's per-photo release control. Absent on the homeowner's side. */
  release?: (photo: MediaItem) => React.ReactNode;
}) {
  if (photos.length === 0) return null;

  return (
    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) => {
        const src =
          photo.externalUrl ?? `/api/files?id=${encodeURIComponent(photo.id)}&kind=photo`;
        return (
          <li key={photo.id} className="overflow-hidden rounded-lg border border-navy-100">
            {/* The photograph itself, not a grey box with the word "Photo" in
                it — which is what a homeowner saw until 2026-09-25. Opens full
                size in a new tab, because people pinch-zoom a tile they cannot
                open. */}
            <a href={src} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={photo.label || 'Site photo'}
                loading="lazy"
                className="h-36 w-full bg-navy-50 object-cover"
              />
            </a>
            {(photo.label !== '' || release !== undefined) && (
              <div className="space-y-1.5 px-2.5 py-2">
                {photo.label !== '' && (
                  <p className="text-xs leading-snug text-navy-600">{photo.label}</p>
                )}
                {release?.(photo)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
