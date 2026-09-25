'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess } from '../access.ts';
import { requireTenantScope } from '../scope.ts';
import { assertCan } from '../permissions.ts';
import { getHubMedia } from '../hub-db/media.ts';

/**
 * Releasing one photograph on an update (Dale, 2026-09-25).
 *
 * ---------------------------------------------------------------------------
 * ONE PHOTOGRAPH AT A TIME, ON PURPOSE
 *
 * The alternative was releasing an update's photos automatically when the PM
 * publishes it. Dale chose per-photo, and it is the right call: a crew member
 * photographs what they need to remember, which is not the same as what a
 * homeowner should see. A neighbour's car, a mess mid-job, somebody's arm.
 *
 * So this changes exactly one flag on exactly one row, and nothing else on it.
 * `media.update` takes a partial patch, so the caption is not touched — an
 * earlier version of this would have blanked it by passing an empty label.
 *
 * Tenant-scoped through `mediaContext`'s scope, so an id from a form cannot
 * reach another contractor's photograph.
 * ---------------------------------------------------------------------------
 */

type Result = { ok: true } | { ok: false; error: string };

export async function setUpdatePhotoRelease(formData: FormData): Promise<Result> {
  const access = await requireAccess();
  if (access.role !== 'contractor') {
    return { ok: false, error: 'Only your contractor can release a photo.' };
  }
  assertCan(access.role, 'update', 'photo');

  const photoId = String(formData.get('photoId') ?? '');
  if (photoId === '') return { ok: false, error: 'No photo was named.' };
  // Presence, not value: an unticked box posts nothing, and reading only the
  // present keys would make UN-releasing a photo a no-op.
  const release = formData.get('release') !== null;

  const scope = await requireTenantScope();
  const media = getHubMedia();
  if (!media.available) return { ok: false, error: 'Photos are not available right now.' };

  try {
    await media.media.update(scope, 'photo', photoId, { clientVisible: release });
  } catch (error) {
    console.error('[update-photos] releasing a photo failed', error);
    return { ok: false, error: 'That did not save. Try again in a moment.' };
  }

  revalidatePath('/dashboard/updates');
  revalidatePath('/portal/updates');
  return { ok: true };
}
