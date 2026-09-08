/**
 * Instant shell for the client portal while a screen's data streams in.
 *
 * The sidebar and context bar persist; this fills the content area the moment
 * a homeowner clicks, so the portal answers at once instead of freezing on the
 * previous screen for the round-trip. Same shimmer vocabulary as the dashboard.
 */
export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="shimmer h-7 w-60 rounded-md" />
        <div className="shimmer h-4 w-80 rounded" />
      </div>
      <div className="shimmer h-14 w-full rounded-lg" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
            <div className="shimmer h-4 w-56 rounded" />
            <div className="shimmer mt-2 h-3 w-72 rounded" />
            <div className="shimmer mt-3 h-3 w-40 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
