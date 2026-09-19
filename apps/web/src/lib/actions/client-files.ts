'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess } from '../access.ts';
import { assertCan } from '../permissions.ts';
import { hubScopeOfProject } from '../tenant-scope.ts';
import { currentDataSource } from '../data/current-source.ts';
import { clientProjectsFor } from '../client-scope.ts';
import { getHubMedia } from '../hub-db/media.ts';
import { getHubStorage } from '../hub-db/storage.ts';
import { CLIENT_FOLDER } from '../document-folders.ts';
import { acceptablePhoto } from '../field-task.ts';

/**
 * A homeowner sending their contractor a file (John, 2026-09-19).
 *
 * The portal's "Upload File" was a button with nothing behind it, and the
 * switch that shows it had nowhere to be stored until migration 0015.
 *
 * ---------------------------------------------------------------------------
 * WHAT A HOMEOWNER MAY WRITE
 *
 * Three gates, in order: the portal master switch, this project's own
 * `Allow File Uploads`, and the project being one of theirs — read from their
 * own memberships, never from the form. The file lands in the project's
 * **Client folder**, client-visible (they sent it, they can see it) and
 * labelled as theirs, so a contractor is never in doubt about where it came
 * from.
 *
 * It is filed as a document whatever it is. A homeowner's photo of a leak is
 * evidence attached to their request, not site progress: the Photos section is
 * the contractor's record of the work, and mixing the two would put client
 * material into a gallery that gets released back to clients.
 * ---------------------------------------------------------------------------
 */

const MAX_FILE_BYTES = 3_500_000;
const ALLOWED = /^(image\/|application\/pdf$)/;

type UploadResult = { ok: true } | { ok: false; error: string };

export async function uploadClientFile(formData: FormData): Promise<UploadResult> {
  const access = await requireAccess();
  if (access.role !== 'client') return { ok: false, error: 'Only the homeowner uploads here.' };
  assertCan(access.role, 'create', 'document');

  const projectId = String(formData.get('projectId') ?? '');
  // A homeowner's session carries no tenant of its own — deliberately, since
  // 2026-09-10: a code sign-in mints no contact id and no auth profile. So the
  // scope comes from the PROJECT, the same way client messaging does, and the
  // project comes from their own memberships rather than from the form.
  const db = await currentDataSource();
  const project = (await clientProjectsFor(access, db)).find(
    (p) => p.buildsuiteProjectId === projectId,
  );
  if (project === undefined) return { ok: false, error: 'That project is not yours.' };
  if (!project.clientPortalEnabled || !project.allowFileUploads) {
    return { ok: false, error: 'Your contractor has not turned on uploads for this project.' };
  }

  const scope = await hubScopeOfProject(project);
  if (scope === null) {
    return { ok: false, error: 'This project is not linked to a contractor, so nothing can be filed under it.' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'No file was received.' };
  if (!ALLOWED.test(file.type)) return { ok: false, error: 'Send a photo or a PDF.' };
  if (file.type.startsWith('image/')) {
    const check = acceptablePhoto({ type: file.type, size: file.size });
    if (!check.ok) return { ok: false, error: check.reason };
  } else if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'That file is too large to send here. Email it to your contractor.' };
  }

  const storage = getHubStorage();
  const media = getHubMedia();
  if (!storage.available || !media.available) {
    return { ok: false, error: 'Uploads are not available right now. Try again later.' };
  }

  try {
    const stored = await storage.storage.upload(scope, {
      projectId,
      kind: 'documents',
      filename: file.name || 'upload',
      contentType: file.type,
      body: await file.arrayBuffer(),
    });
    await media.media.attach(
      scope,
      'document',
      {
        projectId,
        label: `From ${access.session.name || 'the homeowner'}: ${file.name || 'file'}`,
        category: CLIENT_FOLDER,
        storagePath: stored.path,
        // Theirs to see: they sent it.
        clientVisible: true,
      },
      { name: access.session.name },
    );
  } catch (error) {
    console.error('[client-files] a homeowner upload did not save', error);
    return { ok: false, error: 'That file did not send. Check your connection and try again.' };
  }

  revalidatePath('/portal/documents');
  revalidatePath(`/dashboard/projects/${projectId}/documents`);
  return { ok: true };
}
