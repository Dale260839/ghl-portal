'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess } from '../access.ts';
import { currentDataSource } from '../data/current-source.ts';
import { clientProjectsFor } from '../client-scope.ts';
import { hubScopeOfProject } from '../tenant-scope.ts';
import { toClientUpdates } from '../client-view.ts';
import { getHubUpdateFeedback } from '../hub-db/update-feedback.ts';
import { requireTenantScope } from '../scope.ts';

/**
 * A homeowner answering an update, and a contractor answering back
 * (Dale, 2026-09-24).
 *
 * ---------------------------------------------------------------------------
 * WHAT A HOMEOWNER MAY WRITE, AND HOW IT IS PROVED
 *
 * Only against an update that is **theirs** and **published**, and both are
 * proved by reading rather than by trusting the form:
 *
 *   1. the project comes from their own memberships (`clientProjectsFor`),
 *      never from the posted `projectId`;
 *   2. the update must appear in `toClientUpdates` for that project — the same
 *      projection the portal renders, so an update that is Pending or only
 *      "Approved Internally" is not in the list and cannot be commented on.
 *
 * That second check is the one that matters. Without it a homeowner could
 * acknowledge an update they were never shown, which would tell their
 * contractor they had read something they could not have read.
 *
 * A homeowner's own comment is written `client_visible: true`. They wrote it;
 * hiding it from them would be absurd, and their contractor sees everything on
 * the project anyway.
 * ---------------------------------------------------------------------------
 */

type Result = { ok: true } | { ok: false; error: string };

const PORTAL_OFF = 'Your contractor has not turned the portal on for this project.';

/** The update, proved to be this homeowner's and published, or null. */
async function clientUpdate(projectId: string, updateId: string) {
  const access = await requireAccess();
  if (access.role !== 'client') return null;

  const db = await currentDataSource();
  const project = (await clientProjectsFor(access, db)).find(
    (p) => p.buildsuiteProjectId === projectId,
  );
  if (project === undefined || !project.clientPortalEnabled) return null;

  const hubScope = await hubScopeOfProject(project);
  if (hubScope === null) return null;

  const opsDb = await currentDataSource(hubScope);
  const all = await opsDb.listDailyUpdates(hubScope, project.buildsuiteProjectId);
  const published = toClientUpdates(all, project);
  if (!published.some((u) => u.id === updateId)) return null;

  return { access, project };
}

export async function acknowledgeUpdate(formData: FormData): Promise<Result> {
  const projectId = String(formData.get('projectId') ?? '');
  const updateId = String(formData.get('updateId') ?? '');

  const found = await clientUpdate(projectId, updateId);
  if (found === null) return { ok: false, error: PORTAL_OFF };

  const hub = getHubUpdateFeedback();
  if (!hub.available) return { ok: false, error: 'That could not be saved right now.' };

  try {
    await hub.feedback.acknowledge({
      updateId,
      projectId,
      by: found.access.session.name || found.access.session.email || 'the homeowner',
    });
  } catch (error) {
    console.error('[update-feedback] a homeowner acknowledgement did not save', error);
    return { ok: false, error: 'That did not save. Try again in a moment.' };
  }

  revalidatePath('/portal/updates');
  revalidatePath('/dashboard/updates');
  return { ok: true };
}

export async function commentOnUpdate(formData: FormData): Promise<Result> {
  const projectId = String(formData.get('projectId') ?? '');
  const updateId = String(formData.get('updateId') ?? '');
  const body = String(formData.get('body') ?? '');

  if (body.trim() === '') return { ok: false, error: 'Write something first.' };

  const found = await clientUpdate(projectId, updateId);
  if (found === null) return { ok: false, error: PORTAL_OFF };

  const hub = getHubUpdateFeedback();
  if (!hub.available) return { ok: false, error: 'That could not be saved right now.' };

  try {
    await hub.feedback.comment({
      updateId,
      projectId,
      author: found.access.session.name || found.access.session.email || 'the homeowner',
      authorRole: 'client',
      body,
      // Theirs to see: they wrote it.
      clientVisible: true,
    });
  } catch (error) {
    console.error('[update-feedback] a homeowner comment did not save', error);
    return { ok: false, error: 'That did not send. Try again in a moment.' };
  }

  revalidatePath('/portal/updates');
  revalidatePath('/dashboard/updates');
  return { ok: true };
}

/**
 * The contractor's reply.
 *
 * The update is proved by a tenant-scoped read — `listDailyUpdates` filters on
 * the contractor — so an id from the form cannot reach another contractor's
 * update. `clientVisible` is the contractor's choice: a reply the homeowner
 * reads, or a note to the file.
 */
export async function replyToUpdate(formData: FormData): Promise<Result> {
  const access = await requireAccess();
  if (access.role !== 'contractor') return { ok: false, error: 'Only your contractor can reply here.' };

  const updateId = String(formData.get('updateId') ?? '');
  const body = String(formData.get('body') ?? '');
  const clientVisible = formData.get('clientVisible') !== null;
  if (body.trim() === '') return { ok: false, error: 'Write something first.' };

  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const updates = await db.listDailyUpdates(scope);
  const update = updates.find((u) => u.id === updateId);
  if (update === undefined) return { ok: false, error: 'That update is not on your projects.' };

  const hub = getHubUpdateFeedback();
  if (!hub.available) return { ok: false, error: 'That could not be saved right now.' };

  try {
    await hub.feedback.comment({
      updateId,
      projectId: update.projectId,
      author: access.session.name,
      authorRole: 'contractor',
      body,
      clientVisible,
    });
  } catch (error) {
    console.error('[update-feedback] a contractor reply did not save', error);
    return { ok: false, error: 'That did not send. Try again in a moment.' };
  }

  revalidatePath('/dashboard/updates');
  revalidatePath('/portal/updates');
  return { ok: true };
}
