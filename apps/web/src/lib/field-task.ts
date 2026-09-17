/**
 * The crew side of an assigned task (John, 2026-09-17).
 *
 * "It appears for the crew member, but they cannot open the task, cannot edit
 * the status, cannot add images for updates."
 *
 * ---------------------------------------------------------------------------
 * PHOTOS FROM A PHONE
 *
 * Every upload went through a server action, and Next caps a server action's
 * body at 1 MB by default; Vercel caps any request at 4.5 MB. A phone photo is
 * 2–10 MB. So a photo from the job site could not be saved at all.
 *
 * Photos are now shrunk in the browser before they leave the phone — longest
 * edge 2000 px, JPEG — which puts a 12 MP photo at a few hundred KB, sent one
 * per request. That is also what a crew member on a site's mobile data needs.
 * The server still refuses anything over `MAX_PHOTO_BYTES`, so an unshrunk file
 * cannot slip through.
 * ---------------------------------------------------------------------------
 *
 * Pure: no DOM, no request. The canvas work lives in `components/photo-uploader`.
 */

/** Longest edge a job-site photo keeps. Plenty to read a label or a crack. */
export const PHOTO_MAX_EDGE = 2000;

/** The most one upload may carry, after shrinking. Under Next's raised limit. */
export const MAX_PHOTO_BYTES = 3_500_000;

/** Width and height after fitting the longest edge; never enlarged. */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** What the server accepts as a photo. */
export function acceptablePhoto(file: { type: string; size: number }): { ok: true } | { ok: false; reason: string } {
  if (!file.type.startsWith('image/')) return { ok: false, reason: 'That file is not a photo.' };
  if (file.size === 0) return { ok: false, reason: 'That photo is empty.' };
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, reason: 'That photo is too large to upload. Try taking it again with the camera button.' };
  }
  return { ok: true };
}

/** The caption a task photo is filed under, so the PM can tell which job it shows. */
export function taskPhotoCaption(taskName: string): string {
  return `Task: ${taskName.trim()}`;
}

/**
 * What a task update says in the PM's review queue.
 *
 * `hub_daily_updates` has no task column, so the task is named in the text —
 * for a person to read, never matched on by code.
 */
export function taskUpdateText(input: {
  taskName: string;
  text: string;
  photoCount: number;
  newStatus: string | null;
}): string {
  const parts = [`Task: ${input.taskName.trim()}`];
  if (input.text.trim() !== '') parts.push(input.text.trim());
  const notes: string[] = [];
  if (input.newStatus !== null) notes.push(`status set to ${input.newStatus}`);
  if (input.photoCount > 0) notes.push(`${input.photoCount} photo${input.photoCount === 1 ? '' : 's'} added`);
  const body = parts.join(' — ');
  return notes.length === 0 ? body : `${body} (${notes.join(', ')})`;
}
