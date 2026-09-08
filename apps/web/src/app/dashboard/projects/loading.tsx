/**
 * Instant shell while a project (or the project list) loads.
 *
 * Sits under the dashboard layout, so the sidebar stays put and only the
 * content area shows the placeholder.
 */
export default function ProjectsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-3 w-16 shimmer rounded bg-navy-100/70" />
        <div className="h-7 w-72 shimmer rounded-md bg-navy-100" />
        <div className="h-4 w-80 shimmer rounded bg-navy-100/70" />
      </div>
      <div className="flex gap-4 border-b border-navy-100 pb-2.5">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-4 w-20 shimmer rounded bg-navy-100" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-navy-100 bg-white px-5 py-4">
            <div className="h-4 w-56 shimmer rounded bg-navy-100" />
            <div className="mt-2 h-3 w-40 shimmer rounded bg-navy-100/70" />
          </div>
        ))}
      </div>
    </div>
  );
}
