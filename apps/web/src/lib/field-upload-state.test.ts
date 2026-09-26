import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  countUploads,
  retryDelayMs,
  shouldRetry,
  submitGate,
  MAX_UPLOAD_ATTEMPTS,
  type UploadState,
} from './field-upload-state.ts';

/**
 * Whether the day's work can be filed while the photographs are still going up.
 *
 * The rule these tests hold: **in flight blocks, failed does not.** Getting that
 * backwards either loses a photograph from the update it was taken for, or
 * traps a crew member in a basement with an update they cannot send.
 */

const gate = (states: UploadState[]) => submitGate(countUploads(states));

test('§ an update cannot be sent while a photo is still going up', () => {
  // The bug this exists to close: the link to the update travels as a hidden
  // input the uploader renders once a photo has SAVED. Submitting before that
  // silently drops the photograph from the update.
  const held = gate(['saved', 'uploading']);
  assert.equal(held.canSubmit, false);
  assert.equal(held.waitingLabel, '1 photo still uploading…');

  assert.equal(gate(['shrinking']).canSubmit, false, 'shrinking counts as in flight');
});

test('§ an update CAN be sent when a photo has failed', () => {
  // Waiting seconds for an upload is reasonable. Waiting forever for one that
  // will never succeed is not, and a crew member with no signal must still be
  // able to file their day's work.
  const failed = gate(['saved', 'failed']);
  assert.equal(failed.canSubmit, true);
  assert.equal(failed.summary, '1 photo attached. 1 photo did not upload — retry, or send without.');
});

test('§ a failure is never silent', () => {
  // The crew member decides to send without it, rather than finding out
  // afterwards that the photo they took never arrived.
  assert.match(gate(['failed']).summary ?? '', /did not upload/);
  assert.match(gate(['failed', 'failed']).summary ?? '', /2 photos did not upload/);
});

test('nothing is said when there is nothing to say', () => {
  // Every photo saved: the thumbnails are right there, and a line of text
  // repeating what the pictures already show is noise.
  assert.deepEqual(gate(['saved', 'saved']), {
    canSubmit: true,
    waitingLabel: null,
    summary: null,
  });
  assert.deepEqual(gate([]), { canSubmit: true, waitingLabel: null, summary: null });
});

test('both states at once are reported together, and still hold the send', () => {
  const both = gate(['uploading', 'failed', 'saved']);
  assert.equal(both.canSubmit, false);
  assert.match(both.summary ?? '', /still going up/);
  assert.match(both.summary ?? '', /did not upload/);
});

test('one photo is never "1 photos"', () => {
  assert.match(gate(['uploading']).waitingLabel ?? '', /^1 photo still/);
  assert.match(gate(['uploading', 'uploading']).waitingLabel ?? '', /^2 photos still/);
});

// ── Retrying ────────────────────────────────────────────────────────────────

test('§ a retry waits, and waits longer each time, but not for ever', () => {
  // A connection that failed once fails again immediately; the pause is the
  // point. The cap exists because a person is standing there watching.
  assert.equal(retryDelayMs(1), 1_000);
  assert.equal(retryDelayMs(2), 2_000);
  assert.equal(retryDelayMs(3), 4_000);
  assert.equal(retryDelayMs(9), 8_000, 'capped');
  assert.ok(retryDelayMs(0) > 0, 'never zero');
});

test('§ it gives up and says so, rather than spinning', () => {
  assert.equal(shouldRetry(1), true);
  assert.equal(shouldRetry(MAX_UPLOAD_ATTEMPTS - 1), true);
  assert.equal(shouldRetry(MAX_UPLOAD_ATTEMPTS), false);
  assert.equal(shouldRetry(99), false);
});
