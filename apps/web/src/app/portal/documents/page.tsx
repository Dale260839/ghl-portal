import { currentPortalProject, documentsFor } from '@/lib/portal-data';
import { Card, PortalEmpty, shortDate } from '@/components/ui';

export default async function PortalDocuments({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const documents = documentsFor(project);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Document Center</h1>
          <p className="mt-1 text-sm text-navy-400">
            Access contracts, plans, permits, and warranties.
          </p>
        </div>
        {project.allowFileUploads && (
          <button type="button" className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800">
            Upload File
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <PortalEmpty
          title="No documents shared"
          body="Your contractor hasn't shared any documents for this project yet."
        />
      ) : (
        <Card className="overflow-hidden">
          <table className="hidden w-full text-left sm:table">
            <thead>
              <tr className="border-b border-navy-100 bg-navy-50/60 text-xs tracking-wide text-navy-400 uppercase">
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-5 py-2.5 font-medium">Category</th>
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {documents.map((d) => (
                <tr key={d.id} className="transition hover:bg-navy-50/60">
                  <td className="px-5 py-3.5 text-sm font-medium text-navy-900">{d.name}</td>
                  <td className="px-5 py-3.5 text-sm text-navy-600">{d.category}</td>
                  <td className="px-5 py-3.5 text-sm text-navy-400">{shortDate(d.uploadedDate)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button type="button" className="text-sm font-medium text-navy-600 hover:underline">
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="divide-y divide-navy-100 sm:hidden">
            {documents.map((d) => (
              <li key={d.id} className="px-5 py-3.5">
                <div className="text-sm font-medium text-navy-900">{d.name}</div>
                <div className="mt-0.5 text-xs text-navy-400">
                  {d.category} · {shortDate(d.uploadedDate)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        Only documents your contractor has shared appear here. Internal paperwork — supplier
        invoices, cost breakdowns — is never listed.
      </p>
    </div>
  );
}
