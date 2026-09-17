import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignableCrew,
  assigneeLabel,
  assignmentChange,
  isTaskStatus,
  KEEP_ASSIGNEE,
  resolveTaskAssignee,
  type CrewMember,
} from './task-assignment.ts';

/** A contractor assigning a task to the crew on a project (John, 2026-09-17). */

const TEAM: CrewMember[] = [
  { id: 'm-tony', email: 'tony@crew.example', fullName: 'Tony Alvarez', role: 'field', revoked: false },
  { id: 'm-noname', email: 'noname@crew.example', fullName: '', role: 'field', revoked: false },
  { id: 'm-gone', email: 'gone@crew.example', fullName: 'Gone Person', role: 'field', revoked: true },
  { id: 'm-home', email: 'owner@example.com', fullName: 'Dana Johnson', role: 'client', revoked: false },
];
const NOW = '2026-09-17T10:00:00.000Z';

test('only active field crew can be given a task — no homeowner, nobody revoked', () => {
  assert.deepEqual(assignableCrew(TEAM), [
    { id: 'm-noname', label: 'noname@crew.example' },
    { id: 'm-tony', label: 'Tony Alvarez' },
  ]);
});

test('a posted assignee must be one that was offered', () => {
  const options = assignableCrew(TEAM);
  assert.deepEqual(resolveTaskAssignee(options, ''), { kind: 'unassigned' });
  assert.equal(resolveTaskAssignee(options, 'm-tony').kind, 'crew');
  assert.deepEqual(resolveTaskAssignee(options, KEEP_ASSIGNEE), { kind: 'keep' });
  for (const id of ['m-gone', 'm-home', 'another-contractors-crew', 'Tony Alvarez']) {
    assert.deepEqual(resolveTaskAssignee(options, id), { kind: 'unknown' }, id);
  }
});

test('assigning someone is a new "ding"; saving without changing who keeps theirs', () => {
  const options = assignableCrew(TEAM);
  const tony = resolveTaskAssignee(options, 'm-tony');

  assert.deepEqual(assignmentChange(null, tony, NOW), { assignedTo: 'm-tony', assignedAt: NOW });
  assert.deepEqual(assignmentChange('m-noname', tony, NOW), { assignedTo: 'm-tony', assignedAt: NOW }, 'reassigned');
  // Same person: no assignment write, so `seen_at` is left alone and a note fix
  // does not mark the task unread for the crew.
  assert.equal(assignmentChange('m-tony', tony, NOW), null);
  assert.equal(assignmentChange('m-gone', resolveTaskAssignee(options, KEEP_ASSIGNEE), NOW), null, 'kept');
  assert.equal(assignmentChange(null, resolveTaskAssignee(options, ''), NOW), null, 'still unassigned');
});

test('unassigning clears who and when', () => {
  const options = assignableCrew(TEAM);
  assert.deepEqual(assignmentChange('m-tony', resolveTaskAssignee(options, ''), NOW), {
    assignedTo: null,
    assignedAt: null,
  });
});

test('the contractor always sees who a task is with, even after they left', () => {
  assert.equal(assigneeLabel(TEAM, null), 'Unassigned');
  assert.equal(assigneeLabel(TEAM, 'm-tony'), 'Tony Alvarez');
  assert.equal(assigneeLabel(TEAM, 'm-noname'), 'noname@crew.example');
  assert.equal(assigneeLabel(TEAM, 'm-gone'), 'Gone Person (access revoked)');
  assert.equal(assigneeLabel(TEAM, 'm-deleted'), 'Someone no longer on this project');
});

test('status is one of the fixed nine', () => {
  assert.equal(isTaskStatus('Waiting on Inspection'), true);
  assert.equal(isTaskStatus('Done'), false);
  assert.equal(isTaskStatus(''), false);
});
