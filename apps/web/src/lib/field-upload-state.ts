/**
 * What the crew may do while their photos are still going up
 * (Dale, 2026-09-26).
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO CLOSE
 *
 * Since 0019 a photo is filed against the update it was sent with, and the link
 * travels as a hidden input the uploader renders once a photo has SAVED.
 * Nothing stopped a crew member pressing "Send update" while a photo was still
 * in flight: the input did not exist yet, so that photograph was never linked.
 * It survived on the project's Photos page and was missing from the one place
 * it was taken for — the update.
 *
 * On a site with one bar that is not the edge case, it is the normal one.
 *
 * WHAT IS BLOCKED, AND WHAT IS NOT
 *
 * **In flight blocks. Failed does not.** Waiting a few seconds for an upload to
 * finish is reasonable; waiting forever for one that will never succeed is not,
 * and a crew member standing in a basement with no signal must still be able to
 * file their day's work. So a photo that has given up is reported plainly and
 * the update goes without it.
 *
 * Pure, so every message and every decision is tested without a browser, a
 * network or a photograph.
 * ---------------------------------------------------------------------------
 */

export type UploadState = 'shrinking' | 'uploading' | 'saved' | 'failed';

export interface UploadCounts {
  saved: number;
  inFlight: number;
  failed: number;
}

export function countUploads(states: readonly UploadState[]): UploadCounts {
  return {
    saved: states.filter((s) => s === 'saved').length,
    inFlight: states.filter((s) => s === 'shrinking' || s === 'uploading').length,
    failed: states.filter((s) => s === 'failed').length,
  };
}

/** Plural without the "1 photos" that makes an app look unfinished. */
function photos(n: number): string {
  return n === 1 ? '1 photo' : `${n} photos`;
}

export interface SubmitGate {
  /** Whether the update may be sent right now. */
  canSubmit: boolean;
  /** Said on the button while it is held. */
  waitingLabel: string | null;
  /**
   * What will and will not be sent, in one line. Null when there is nothing
   * worth saying — no photos at all, or every one of them saved and the crew
   * can see the thumbnails for themselves.
   */
  summary: string | null;
}

export function submitGate(counts: UploadCounts): SubmitGate {
  const { saved, inFlight, failed } = counts;

  if (inFlight > 0) {
    return {
      canSubmit: false,
      waitingLabel: `${photos(inFlight)} still uploading…`,
      summary:
        failed > 0
          ? `${photos(inFlight)} still going up. ${photos(failed)} did not upload — retry, or send without.`
          : `${photos(inFlight)} still going up. The update will send when they are done.`,
    };
  }

  if (failed > 0) {
    // Never silent: the crew member decides to send without it, rather than
    // finding out afterwards that the photo they took never arrived.
    return {
      canSubmit: true,
      waitingLabel: null,
      summary:
        saved > 0
          ? `${photos(saved)} attached. ${photos(failed)} did not upload — retry, or send without.`
          : `${photos(failed)} did not upload — retry, or send the update without them.`,
    };
  }

  return { canSubmit: true, waitingLabel: null, summary: null };
}

/**
 * How long to wait before trying a failed upload again.
 *
 * Doubling, capped, and never zero. A site connection that failed once fails
 * again immediately; the pause is the point. Capped at eight seconds because a
 * person is standing there watching, and an app that looks stuck is one they
 * close.
 */
export function retryDelayMs(attempt: number): number {
  const base = 1_000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(base, 8_000);
}

/** Give up after this many tries, and say so rather than spinning. */
export const MAX_UPLOAD_ATTEMPTS = 3;

export function shouldRetry(attempt: number): boolean {
  return attempt < MAX_UPLOAD_ATTEMPTS;
}
