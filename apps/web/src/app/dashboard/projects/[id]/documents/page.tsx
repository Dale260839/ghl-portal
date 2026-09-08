import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { DOCUMENTS } from '@/lib/data/portal-fixtures';
import { Badge, Card, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Documents — contractor control side. Every file on the project, and whether
 * each one is shared with the client. The client sees only the ones marked
 * visible; a permit or a plan you are still working on stays on your side.
 */
export default async function ProjectDocumentsControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const docs = DOCUMENTS.filter((d) => d.projectId === id).sort((a, b) =>
    b.uploadedDate.localeCompare(a.uploadedDate),
  );

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Documents"
        subtitle="Every file on the project. Share the ones the client should have."
        clientHref={`/portal/documents?preview=${id}`}
        action={<ControlButton>Upload</ControlButton>}
      />

      <ControlNote>
        Contracts, permits, plans, warranties, and change orders live here. Only files you mark
        client-visible show up in the homeowner&rsquo;s Documents screen.
      </ControlNote>

      {docs.length === 0 ? (
        <ControlEmpty title="No documents" body="Upload the first file for this project." />
      ) : (
        <Card>
          <ul className="divide-y divide-navy-100">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-navy-900">{d.name}</span>
                    <Badge>{d.category}</Badge>
                    <VisibilityTag shown={project.clientPortalEnabled && d.clientVisible} />
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    Uploaded {shortDate(d.uploadedDate)}
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
                >
                  {d.clientVisible ? 'Unshare' : 'Share with client'}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
