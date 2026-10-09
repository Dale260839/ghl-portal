/**
 * What the crew sees while the next screen is on its way.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PERFORMANCE FIX AND NOT A DECORATION
 *
 * There were ten crew screens and no loading boundary under any of them.
 * Tapping the bottom bar did nothing visible for two or three seconds, which
 * on a job site reads as a broken app and earns a second tap.
 *
 * Two things were wrong, and this file fixes both:
 *
 *   1. **No feedback.** Without a Suspense boundary there is nothing to show
 *      between the tap and the server's answer, so the old screen simply sits
 *      there looking ignored.
 *
 *   2. **No prefetch.** For a dynamic route, `<Link>` prefetches only as far
 *      as the nearest `loading.tsx`. With none, every tap paid the full round
 *      trip on the spot — the prefetching Next.js does by default was buying
 *      nothing at all.
 *
 * It lives at `/field` rather than beside each page because a loading
 * boundary covers every segment beneath it, and ten copies of this would drift.
 *
 * The shape matches the real screens — a card, a header strip, a few rows — so
 * the content lands into the same layout rather than shoving it around.
 * ---------------------------------------------------------------------------
 */
export default function FieldLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      {[0, 1].map((card) => (
        <div
          key={card}
          className="overflow-hidden rounded-xl border border-navy-100 bg-white shadow-[0_1px_2px_rgba(10,31,68,0.06)]"
        >
          <div className="border-b border-navy-100 px-4 py-3.5">
            <div className="shimmer h-3 w-28 rounded" />
          </div>
          <div className="divide-y divide-navy-100">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-start justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1 space-y-2">
                  {/* Two widths, so it reads as text rather than as a bar. */}
                  <div className="shimmer h-3.5 w-3/4 rounded" />
                  <div className="shimmer h-3 w-1/2 rounded" />
                </div>
                <div className="shimmer h-5 w-20 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
