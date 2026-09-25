import { currentPortalProject } from '@/lib/portal-data';
import { getHubUpdateFeedback } from '@/lib/hub-db/update-feedback';
import { getHubMedia } from '@/lib/hub-db/media';
import { UpdatePhotos } from '@/components/update-photos';
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

  // ── The photographs that belong to each update ────────────────────────────
  //
  // Until 2026-09-25 this took the two most recent photos on the whole project
  // and pinned them to the newest update — a fixture behaviour the code openly
  // admitted to — and then drew each one as a grey box with the word "Photo"
  // in it. On a real project that meant every update showed either somebody
  // else's photographs or none, and never the actual picture.
  //
  // `true` is the release gate: only photographs the contractor has released,
  // one at a time. It is an argument of the read rather than a filter on the
  // template, so a future template cannot forget it.
  const mediaStore = getHubMedia();
  const updatePhotos =
    hubScope !== null && mediaStore.available
      ? await mediaStore.media
          .listForUpdates(hubScope, 'photo', updates.map((u) => u.id), true)
          .catch(() => [])
      : [];

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
          {updates.map((u) => {
            const attached = updatePhotos.filter((p) => p.updateId === u.id);
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

                <UpdatePhotos photos={attached} />

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
