import { SubmitButton } from '@/components/submit-button';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { getHubMedia, type MediaItem } from '@/lib/hub-db/media';
import { attachProjectFile } from '@/lib/actions';
import { Card, shortDate } from '@/components/ui';

/**
 * Site photos, from the phone.
 *
 * Chris, 11 Sep: the crew should be able to "take pictures and upload" from the
 * job. This is that screen. The camera opens straight from the file field on a
 * phone (`capture="environment"`), the photo goes to the Hub bucket under the
 * project, and the row is saved internal. Releasing a photo to the homeowner
 * stays with the contractor on the Photos tab, as with everything the crew
 * files.
 *
 * Same scoping as every field screen: only the projects this person is on.
 */

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

export default async function FieldPhotos({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project: preselect } = await searchParams;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  if (scope.contractorId === undefined) {
    return (
      <Card className="px-4 py-8 text-center">
        <p className="text-sm text-navy-400">
          Your account is not linked to a company yet. Ask your PM to check your invitation.
        </p>
      </Card>
    );
  }

  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(await requireAccess(), projects, tasks);
  const hub = getHubMedia();

  const byProject: { projectId: string; projectName: string; photos: MediaItem[] }[] = [];
  if (hub.available) {
    for (const project of mine) {
      const photos = await hub.media.listForProject(scope, 'photo', project.buildsuiteProjectId);
      if (photos.length > 0) {
        byProject.push({ projectId: project.buildsuiteProjectId, projectName: project.projectName, photos });
      }
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Site photos</h1>
        <p className="mt-1 text-sm text-navy-400">
          Take one on site and it is on the job file before you leave.
        </p>
      </div>

      {!hub.available ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            The Hub database is not connected, so photos cannot be saved. Missing:{' '}
            {hub.missing.join(', ')}.
          </p>
        </Card>
      ) : mine.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">No projects are assigned to you yet.</p>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-navy-100 px-4 py-3 text-xs font-semibold tracking-wide text-navy-500 uppercase">
            Add a photo
          </div>
          <form action={attachProjectFile} className="space-y-3 px-4 py-4">
            <input type="hidden" name="kind" value="photo" />
            <label className="block text-xs text-navy-500">
              Project
              <select name="projectId" defaultValue={preselect ?? mine[0]?.buildsuiteProjectId} className={`${FIELD} mt-1 w-full`}>
                {mine.map((p) => (
                  <option key={p.buildsuiteProjectId} value={p.buildsuiteProjectId}>
                    {p.projectName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-navy-500">
              Photo
              {/* `capture` opens the camera on a phone rather than the gallery.
                  On a laptop it is an ordinary file picker. */}
              <input
                type="file"
                name="file"
                accept="image/*"
                capture="environment"
                required
                className={`${FIELD} mt-1 w-full`}
              />
            </label>
            <label className="block text-xs text-navy-500">
              Caption (optional)
              <input name="label" placeholder="e.g. Rough-in, north wall" className={`${FIELD} mt-1 w-full`} />
            </label>
            <SubmitButton className="w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-navy-700">
              Upload photo
            </SubmitButton>
            <p className="text-xs text-navy-400">
              Saved to the job, internal. Your PM decides what the homeowner sees.
            </p>
          </form>
        </Card>
      )}

      {byProject.map((group) => (
        <Card key={group.projectId} className="px-4 py-4">
          <div className="text-sm font-semibold text-navy-900">{group.projectName}</div>
          <ul className="mt-2 divide-y divide-navy-100">
            {group.photos.map((photo) => (
              <li key={photo.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-navy-800">
                    {photo.label === '' ? 'Untitled photo' : photo.label}
                  </span>
                  <span className="block text-xs text-navy-400">
                    {shortDate(photo.createdAt.slice(0, 10))}
                    {photo.clientVisible ? ' · shared with the homeowner' : ' · internal'}
                  </span>
                </span>
                {(photo.externalUrl !== null || photo.storagePath !== null) && (
                  <a
                    href={photo.externalUrl ?? `/api/files?path=${encodeURIComponent(photo.storagePath ?? '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-lg border border-navy-200 px-3 py-1 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Open
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
