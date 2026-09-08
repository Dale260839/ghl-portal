/**
 * Instant shell for the contractor dashboard while a page's data streams in.
 *
 * The sidebar and context bar are already on screen (the layout persists across
 * navigations); this fills the content area so a click responds at once instead
 * of leaving the previous screen frozen until the database answers.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-7 w-64 animate-pulse rounded-md bg-navy-100" />
        <div className="h-4 w-96 animate-pulse rounded bg-navy-100/70" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
            <div className="h-4 w-28 animate-pulse rounded bg-navy-100" />
            <div className="mt-3 h-8 w-16 animate-pulse rounded bg-navy-100" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-navy-100/70" />
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
              <div className="h-4 w-48 animate-pulse rounded bg-navy-100" />
              <div className="mt-2 h-3 w-32 animate-pulse rounded bg-navy-100/70" />
              <div className="mt-4 h-1.5 w-full animate-pulse rounded-full bg-navy-100" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
              <div className="h-4 w-40 animate-pulse rounded bg-navy-100" />
              <div className="mt-2 h-3 w-56 animate-pulse rounded bg-navy-100/70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
