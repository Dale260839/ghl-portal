import { NotLinkedToContractor } from '@/components/not-linked';
import { getHubMedia } from '@/lib/hub-db/media';
import { MediaManager } from '@/components/media-manager';
import { getProposalsReader, pickCurrentProposal } from '@/lib/buildsuite/proposals';
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

  // ---------------------------------------------------------------------------
  // THE SIGNED CONTRACT, listed here as well as on Projects (John, 2026-09-15).
  //
  // The same file as the Signed PDF column: the project's current proposal —
  // signed over accepted over submitted, the rule `pickCurrentProposal` applies
  // for that column too — and its `signed_pdf_url`.
  //
  // It is read from BuildSuite, NOT from the Hub, and rendered by this page
  // rather than inside the file manager, for two reasons:
  //
  //   · it has to show when the Hub is down; the file manager shows only
  //     "not connected" then, and the contract is not a Hub file;
  //   · it must NEVER be releasable. Sing, 2026-09-09: the link is public and
  //     unauthenticated — anyone holding it opens the contract, prices and
  //     address included. Fine behind a contractor's login; not to be shared
  //     out. Every Hub document can be released into the Client folder, so the
  //     contract is kept out of that list entirely. The §9.1 guardrail already
  //     refuses it on every client-facing surface.
  // ---------------------------------------------------------------------------
  let contract: { signedPdfUrl: string | null; signedAt: string | null } | null = null;
  const proposals = getProposalsReader();
  if (proposals.available) {
    try {
      const current = pickCurrentProposal(await proposals.listForProjects(scope, [id]));
      if (current !== null && current.signed) {
        contract = { signedPdfUrl: current.signedPdfUrl, signedAt: current.signedAt };
      }
    } catch {
      // BuildSuite unreachable: say nothing rather than claim there is no contract.
      contract = null;
    }
  }

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

      {contract !== null && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-navy-900">Signed contract</h2>
            <span className="text-xs text-navy-400">From BuildSuite · visible to you only</span>
          </div>
          <Card className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-navy-900">Signed contract (PDF)</span>
              <Badge tone="good">Signed</Badge>
              <Badge tone="neutral">Contractor only</Badge>
              {contract.signedAt !== null && (
                <span className="ml-auto text-xs text-navy-400">
                  signed {shortDate(contract.signedAt.slice(0, 10))}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs">
              {contract.signedPdfUrl !== null ? (
                <a
                  href={contract.signedPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-navy-600 underline underline-offset-2"
                >
                  Open the signed PDF
                </a>
              ) : (
                <span className="text-navy-400">
                  No link available — BuildSuite has not recorded the signed PDF for this contract.
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-navy-400">
              The same file as the Signed PDF column on Projects. Its link is public — anyone holding
              it can open the contract, prices and address included — so it stays on your screens and
              cannot be released into the Client folder.
            </p>
          </Card>
        </section>
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
