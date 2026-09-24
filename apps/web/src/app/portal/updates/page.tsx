import { currentPortalProject, photosFor } from '@/lib/portal-data';
import { getHubUpdateFeedback } from '@/lib/hub-db/update-feedback';
import { UpdateFeedback } from '@/components/update-feedback';

import { scopeOfProject } from '@/lib/scope';
import { hubScopeOfProject } from '@/lib/tenant-scope';
import { toClientUpdates } from '@/lib/client-view';
import { Card, PortalEmpty, shortDate } from '@/components/ui';
import { currentDataSource } from '@/lib/data/current-source';

/**
 * Daily Updates, client view.
 *
 * Only `Approved & Published` updates appear, and only their client summary
 * (§10). The field's internal notes are not filtered out here — they are never
 * read on this path, so no future change to this template can leak them.
 */
export default async function PortalUpdates({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  // Through a source that knows the project's contractor, so the Hub's
  // published updates are read. Without the contractor the read is empty, and
  // that is the honest answer rather than a thrown TenancyError.
  const hubScope = await hubScopeOfProject(project);
  const opsDb = await currentDataSource(hubScope ?? undefined);
  const all = await opsDb.listDailyUpdates(
    hubScope ?? scopeOfProject(project),
    project.buildsuiteProjectId,
  );
  const updates = toClientUpdates(all, project);
  const photos = (await photosFor(project));

  // What has already been said. The ids come from `updates`, which is the
  // published projection above — so nothing is read for an update this
  // homeowner was never shown.
  const feedbackStore = getHubUpdateFeedback();
  const feedback = feedbackStore.available
    ? await feedbackStore.feedback
        .forUpdates(updates.map((u) => u.id))
        .catch(() => ({ acknowledgements: [], comments: [] }))
    : { acknowledgements: [], comments: [] };
  const me = project.clientName;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Daily Updates</h1>
        <p className="mt-1 text-sm text-navy-400">
          Logs, photos, and progress notes from the field.
        </p>
      </div>

      {updates.length === 0 ? (
        <PortalEmpty
          title="No updates published yet"
          body="Your contractor reviews every field update before it appears here, so there's nothing waiting on you."
        />
      ) : (
        <div className="space-y-5">
          {updates.map((u, index) => {
            // Photos are attached to the most recent update in fixtures; with
            // live data they carry their own source_update_id.
            const attached = index === 0 ? photos.slice(0, 2) : [];
            return (
              <Card key={u.id} className="p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-700">
                    {project.projectManager
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-navy-900">{project.projectManager}</div>
                    <div className="text-xs text-navy-400">
                      Project Manager · {shortDate(u.updateDate)}
                    </div>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-relaxed text-navy-700">{u.clientSummary}</p>

                {attached.length > 0 && (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {attached.map((p) => (
                      <div key={p.id} className="overflow-hidden rounded-lg border border-navy-100">
                        <div className="flex h-40 items-center justify-center bg-navy-50 text-xs text-navy-400">
                          {/* Real photos arrive with the hub_photos table. */}
                          Photo
                        </div>
                        <div className="px-3 py-2 text-xs text-navy-600">{p.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* The conversation on this update. Only client-visible
                    comments: an internal note by the contractor is on the same
                    record and must never appear here. */}
                {feedback.comments.filter((c) => c.updateId === u.id && c.clientVisible).length >
                  0 && (
                  <ul className="mt-4 space-y-2.5 border-t border-navy-100 pt-3.5">
                    {feedback.comments
                      .filter((c) => c.updateId === u.id && c.clientVisible)
                      .map((c) => (
                        <li key={c.id} className="text-sm">
                          <span className="font-medium text-navy-900">
                            {c.authorRole === 'client' ? 'You' : c.author}
                          </span>{' '}
                          <span className="text-xs text-navy-400">{shortDate(c.createdAt)}</span>
                          <p className="mt-0.5 leading-relaxed text-navy-700">{c.body}</p>
                        </li>
                      ))}
                  </ul>
                )}

                <UpdateFeedback
                  projectId={project.buildsuiteProjectId}
                  updateId={u.id}
                  acknowledged={feedback.acknowledgements.some(
                    (a) => a.updateId === u.id && a.acknowledgedBy === me,
                  )}
                  replies={feedback.comments.filter((c) => c.updateId === u.id).length}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
