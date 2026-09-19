import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFieldSubmissionEmail } from './pm-email.ts';

/** The email that tells a PM their crew sent something (John, 2026-09-19). */

const base = {
  kind: 'task' as const,
  companyName: 'Alliance Pro Services',
  projectName: 'Kitchen remodel',
  projectReference: 'BSA-052',
  submittedBy: 'Tony Alvarez',
  taskName: 'Rough-in electrical',
  workCompleted: 'Circuits run, boxes set',
  blocker: '',
  photoCount: 2,
  reviewUrl: 'https://hub.example/dashboard/updates',
};

test('an ordinary submission says who, which job, and links to the queue', () => {
  const { subject, html } = buildFieldSubmissionEmail(base);
  assert.equal(subject, 'Tony Alvarez sent an update on Kitchen remodel (BSA-052)');
  assert.match(html, /Rough-in electrical/);
  assert.match(html, /Circuits run, boxes set/);
  assert.match(html, /2 added/);
  assert.match(html, /href="https:\/\/hub\.example\/dashboard\/updates"/);
});

test('a blocker leads the subject — it is the one that stops work', () => {
  const { subject, html } = buildFieldSubmissionEmail({ ...base, blocker: 'Panel is locked, no key on site' });
  assert.equal(subject, 'Blocker on Kitchen remodel (BSA-052) — Tony Alvarez');
  assert.match(html, /Panel is locked, no key on site/);
});

test('a daily update carries no task line, and a flagged decision shows', () => {
  const { html } = buildFieldSubmissionEmail({
    ...base,
    kind: 'daily',
    taskName: undefined,
    photoCount: 0,
    clientDecisionNeeded: true,
  });
  assert.equal(html.includes('Task'), false);
  assert.equal(html.includes('added'), false, 'no photo row when there are none');
  assert.match(html, /client needs to decide/i);
});

test('it says plainly that nothing has reached the homeowner', () => {
  // The whole point of the review queue: this email must not read like
  // something was published.
  assert.match(buildFieldSubmissionEmail(base).html, /Nothing reaches the homeowner until you publish/);
});

test('a project with no code is named, not labelled with an empty bracket', () => {
  const { subject } = buildFieldSubmissionEmail({ ...base, projectReference: '' });
  assert.equal(subject, 'Tony Alvarez sent an update on Kitchen remodel');
});

test('whatever the crew typed is text, not markup', () => {
  const { html } = buildFieldSubmissionEmail({
    ...base,
    workCompleted: '<script>alert(1)</script>',
    blocker: '<img src=x onerror=alert(1)>',
  });
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img src=x'), false);
  assert.match(html, /&lt;script&gt;/);
});
