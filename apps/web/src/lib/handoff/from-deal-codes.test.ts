import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyProjectCode, hasUsableProjectCode } from './from-deal.ts';

/**
 * The two shapes Sing confirmed on 2026-09-03, and the distinction that matters
 * most: a null code is PENDING, not missing.
 */

test('feed and client projects use the Alliance-wide series', () => {
  assert.equal(classifyProjectCode('BSA-044'), 'feed');
  assert.equal(classifyProjectCode('BSA-1'), 'feed');
  assert.equal(classifyProjectCode('BSA-101'), 'feed');
});

test('contractor-created projects carry the contractor letters', () => {
  assert.equal(classifyProjectCode('BSA-ASJF-006'), 'contractor');
  assert.equal(classifyProjectCode('BSA-APS-001'), 'contractor');
});

test('APS is allowed as a three-letter exception', () => {
  // Sing is setting APS directly as a one-off, three letters not four.
  assert.equal(classifyProjectCode('BSA-APS-001'), 'contractor');
  assert.equal(hasUsableProjectCode('BSA-APS-001'), true);
});

test('a null code is PENDING, not missing — the contractor has not picked letters yet', () => {
  assert.equal(classifyProjectCode(null), 'pending');
  assert.equal(classifyProjectCode(''), 'pending');
  assert.equal(classifyProjectCode('   '), 'pending');
});

test('pending is not usable as an identity, but it is not malformed either', () => {
  assert.equal(hasUsableProjectCode(null), false);
  assert.notEqual(classifyProjectCode(null), 'malformed');
});

test('anything outside both allocator shapes is malformed', () => {
  assert.equal(classifyProjectCode('BSP-2026-000044'), 'malformed');
  assert.equal(classifyProjectCode('7b9eefb9-41d2-424a-8885-68ac4f941454'), 'malformed');
  assert.equal(classifyProjectCode('BSA-'), 'malformed');
  assert.equal(classifyProjectCode('044'), 'malformed');
});

test('a UUID is never mistaken for a key — the old fallback would have passed one through', () => {
  assert.equal(hasUsableProjectCode('7b9eefb9-41d2-424a-8885-68ac4f941454'), false);
});

test('whitespace around a real code does not break it', () => {
  assert.equal(classifyProjectCode('  BSA-044  '), 'feed');
  assert.equal(hasUsableProjectCode('  BSA-ASJF-006 '), true);
});
