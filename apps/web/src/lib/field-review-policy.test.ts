import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canChangeFieldTask, pendingReviewCount } from './field-review-policy.ts';
import type { Session } from './session.ts';

const field = { role: 'field', membershipId: 'crew-1' } as Session;
const task = { projectId: 'project-1', assignedTo: 'crew-1' };

test('field may start and request review for its own assigned task', () => {
  for (const status of ['In Progress', 'Ready for Review']) {
    assert.equal(canChangeFieldTask(field, ['project-1'], task, status), true);
  }
});

test('field status changes reject other people, removed assignments and arbitrary states', () => {
  assert.equal(canChangeFieldTask(field, [], task, 'In Progress'), false);
  assert.equal(canChangeFieldTask(field, ['project-1'], { ...task, assignedTo: 'crew-2' }, 'In Progress'), false);
  assert.equal(canChangeFieldTask(field, ['project-1'], { ...task, assignedTo: null }, 'In Progress'), false);
  assert.equal(canChangeFieldTask(field, ['project-1'], task, 'Completed'), false);
  assert.equal(canChangeFieldTask({ role: 'client' } as Session, ['project-1'], task, 'In Progress'), false);
});

test('only pending updates count as awaiting review', () => {
  assert.equal(pendingReviewCount([
    { managerApprovalStatus: 'Pending' },
    { managerApprovalStatus: 'Approved Internally' },
    { managerApprovalStatus: 'Approved & Published' },
  ]), 1);
  assert.equal(pendingReviewCount([]), 0);
});
