import { NotLinkedToContractor } from '@/components/not-linked';
import { getHubMedia } from '@/lib/hub-db/media';
import { MediaManager } from '@/components/media-manager';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { DOCUMENTS } from '@/lib/data/portal-fixtures';
import { Badge, Card, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

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

  // Nine of the sixty-eight accounts on this location do not resolve to a
  // contractor record, and everything the Hub stores is filed under one. Say
  // so rather than throwing: `assertContractor` is right to refuse, but a
  // TenancyError on screen tells the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Documents" />;
  }

  const hub = getHubMedia();
  const items = hub.available ? await hub.media.listForProject(scope, 'document', id) : [];
  // Three gates: the portal master switch, Show Documents on the project, and
  // the row's own release flag.
  const released = project.clientPortalEnabled && project.showDocuments;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Documents"
        subtitle="Every file on the project. Share the ones the client should have."
        clientHref={`/portal/documents?preview=${id}`}
      />

      <ControlNote>
        Every file sits in a folder. The Client folder is the only one the homeowner can see into,
        and a document there still has to be released before it shows up on their Documents screen.
        Field folders are for the crew and subcontractors, one per trade, and are never shared with
        the homeowner.
      </ControlNote>

      {(project.scopeOfWorkUrl ?? null) !== null && (
        <ControlNote>
          The signed scope of work from BuildSuite is{' '}
          <a href={project.scopeOfWorkUrl ?? '#'} target="_blank" rel="noreferrer" className="font-medium text-navy-800 underline underline-offset-2">
            here (PDF)
          </a>
          . The crew see the same link under Docs. To hand the homeowner a copy, link it into the
          Client folder below and release it.
        </ControlNote>
      )}

      <MediaManager
        kind="document"
        projectId={id}
        items={items}
        released={released}
        hub={hub.available ? { available: true, missing: [] } : { available: false, missing: hub.missing }}
      />
    </div>
  );
}
