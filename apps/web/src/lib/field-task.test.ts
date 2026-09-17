import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptablePhoto,
  fitWithin,
  MAX_PHOTO_BYTES,
  PHOTO_MAX_EDGE,
  taskPhotoCaption,
  taskUpdateText,
} from './field-task.ts';

/** The crew side of a task: photos from a phone, and the update the PM reads. */

test('a phone photo is shrunk to the longest edge, keeping its shape', () => {
  // A 12 MP phone photo, both ways round.
  assert.deepEqual(fitWithin(4032, 3024), { width: PHOTO_MAX_EDGE, height: 1500 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1500, height: PHOTO_MAX_EDGE });
  // A 48 MP one.
  assert.deepEqual(fitWithin(8000, 6000), { width: 2000, height: 1500 });
});

test('a small photo is never enlarged, and nonsense sizes do not throw', () => {
  assert.deepEqual(fitWithin(1200, 900), { width: 1200, height: 900 });
  assert.deepEqual(fitWithin(0, 900), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(10000, 1), { width: 2000, height: 1 });
});

test('the server takes photos only, and none past the size an upload can carry', () => {
  assert.deepEqual(acceptablePhoto({ type: 'image/jpeg', size: 400_000 }), { ok: true });
  assert.equal(acceptablePhoto({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 }).ok, false);
  assert.equal(acceptablePhoto({ type: 'application/pdf', size: 10_000 }).ok, false);
  assert.equal(acceptablePhoto({ type: 'image/png', size: 0 }).ok, false);
  // Under Next's raised 4 MB action limit and Vercel's 4.5 MB request cap.
  assert.ok(MAX_PHOTO_BYTES < 4 * 1024 * 1024);
});

test('the PM can tell which task an update or a photo is about', () => {
  assert.equal(taskPhotoCaption('  Rough-in electrical, kitchen '), 'Task: Rough-in electrical, kitchen');
  assert.equal(
    taskUpdateText({ taskName: 'Rough-in electrical', text: 'Circuits run, boxes set', photoCount: 3, newStatus: 'Ready for Review' }),
    'Task: Rough-in electrical — Circuits run, boxes set (status set to Ready for Review, 3 photos added)',
  );
  assert.equal(
    taskUpdateText({ taskName: 'Pull cabinets', text: '', photoCount: 1, newStatus: null }),
    'Task: Pull cabinets (1 photo added)',
  );
  assert.equal(taskUpdateText({ taskName: 'Pull cabinets', text: 'Done', photoCount: 0, newStatus: null }), 'Task: Pull cabinets — Done');
});
