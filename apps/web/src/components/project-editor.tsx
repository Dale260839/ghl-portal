import { archiveProject, editProjectDetails, restoreArchivedItem } from '@/lib/actions';
import { Badge, Card, CardHeader } from '@/components/ui';
import type { ProjectOverlay } from '@/lib/hub-db/records';

/**
 * Editing and archiving a project.
 *
 * The project itself belongs to BuildSuite and we never write there. Everything
 * here saves an OVERLAY in the Hub's own database, rendered on top of the
 * BuildSuite record. That is why each field shows what BuildSuite holds
 * underneath: the contractor should be able to see what they are overriding,
 * and clearing a field should feel like "stop overriding this" rather than
 * "delete the data".
 *
 * Archive is deliberately not styled as a danger action, because it is not one.
 * Nothing is destroyed, it is attributed, and it is one click to undo from the
 * Archive screen. Dressing a reversible action in red teaches people to fear
 * the wrong things.
 */

export function ProjectEditor({
  projectId,
  overlay,
  buildSuite,
}: {
  projectId: string;
  overlay: ProjectOverlay | null;
  buildSuite: { title: string; address: string; clientName: string };
}) {
  const archived = overlay?.archivedAt != null;

  const field = (
    name: string,
    label: string,
    override: string | null | undefined,
    original: string,
  ) => (
    <div>
      <label htmlFor={`edit-${name}`} className="text-xs font-medium text-navy-600">
        {label}
      </label>
      <input
        id={`edit-${name}`}
        name={name}
        defaultValue={override ?? ''}
        placeholder={original === '' ? 'Not set in BuildSuite' : original}
        className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
      />
      {override != null && override !== '' && original !== '' && (
        <p className="mt-1 text-xs text-navy-400">
          BuildSuite has &ldquo;{original}&rdquo;. Clear this box to use theirs again.
        </p>
      )}
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Edit this project"
        action={
          archived ? <Badge tone="warn">Archived</Badge> : <Badge tone="neutral">Hub overlay</Badge>
        }
      />

      {archived ? (
        <div className="px-5 py-5">
          <p className="text-sm text-navy-600">
            This project is archived
            {overlay?.archivedBy != null && ` by ${overlay.archivedBy}`}
            {overlay?.archiveReason != null && overlay.archiveReason !== ''
              ? ` — ${overlay.archiveReason}`
              : '.'}
          </p>
          <p className="mt-1 text-xs text-navy-400">
            It is hidden from the working list. Nothing has been deleted.
          </p>
          <form action={restoreArchivedItem} className="mt-3">
            <input type="hidden" name="table" value="project" />
            <input type="hidden" name="id" value={projectId} />
            <input type="hidden" name="projectId" value={projectId} />
            <button
              type="submit"
              className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
            >
              Restore this project
            </button>
          </form>
        </div>
      ) : (
        <>
          <form action={editProjectDetails} className="space-y-3 px-5 py-4">
            <input type="hidden" name="projectId" value={projectId} />
            {field('title', 'Project name', overlay?.titleOverride, buildSuite.title)}
            {field('address', 'Address', overlay?.addressOverride, buildSuite.address)}
            {field('clientName', 'Client', overlay?.clientNameOverride, buildSuite.clientName)}
            <div>
              <label htmlFor="edit-notes" className="text-xs font-medium text-navy-600">
                Internal notes
              </label>
              <textarea
                id="edit-notes"
                name="notes"
                rows={3}
                defaultValue={overlay?.notes ?? ''}
                placeholder="Never shown to the client."
                className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
            >
              Save changes
            </button>
          </form>

          <form
            action={archiveProject}
            className="flex flex-wrap items-end gap-2 border-t border-navy-100 px-5 py-4"
          >
            <input type="hidden" name="projectId" value={projectId} />
            <div className="min-w-0 flex-1">
              <label htmlFor="archive-reason" className="text-xs font-medium text-navy-600">
                Archive this project
              </label>
              <input
                id="archive-reason"
                name="reason"
                placeholder="Why? e.g. duplicate, job cancelled"
                className="mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-navy-200 px-3 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
            >
              Archive
            </button>
          </form>
        </>
      )}

      <p className="border-t border-navy-100 px-5 py-3 text-xs leading-relaxed text-navy-400">
        Edits are stored in the Hub and shown on top of BuildSuite&apos;s record. BuildSuite is
        never written to, so their data stays exactly as their team left it.
      </p>
    </Card>
  );
}
