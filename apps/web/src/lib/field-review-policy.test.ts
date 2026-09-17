import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingReviewCount } from './field-review-policy.ts';

test('only pending updates count as awaiting review', () => {
  assert.equal(pendingReviewCount([
    { managerApprovalStatus: 'Pending' },
    { managerApprovalStatus: 'Approved Internally' },
    { managerApprovalStatus: 'Approved & Published' },
  ]), 1);
  assert.equal(pendingReviewCount([]), 0);
});
