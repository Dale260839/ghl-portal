/**
 * Instant response to a tab click inside a project's workspace.
 *
 * The project header and tab strip live in the layout above and persist, so
 * switching Schedule to Designs swaps only this area. Painting a placeholder
 * immediately is what makes the strip feel like tabs rather than page loads.
 */
export default function ProjectScreenLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-56 animate-pulse rounded-md bg-navy-100" />
          <div className="h-4 w-96 animate-pulse rounded bg-navy-100/70" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-36 animate-pulse rounded-lg bg-navy-100" />
          <div className="h-9 w-32 animate-pulse rounded-lg bg-navy-100" />
        </div>
      </div>
      <div className="h-12 w-full animate-pulse rounded-lg bg-navy-100/60" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
            <div className="h-4 w-52 animate-pulse rounded bg-navy-100" />
            <div className="mt-2 h-3 w-72 animate-pulse rounded bg-navy-100/70" />
            <div className="mt-3 h-3 w-40 animate-pulse rounded bg-navy-100/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
