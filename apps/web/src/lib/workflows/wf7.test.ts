/**
 * WF7 — Issue Submitted, asserted against §11.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectsOfType, type Effect } from './effects.ts';
import { issueNumberFor, planIssueSubmitted, type Wf7Trigger } from './wf7-issue-submitted.ts';

const trigger: Wf7Trigger = {
  buildsuiteProjectId: 'BSP-2026-000184',
  issueId: 'issue-99',
  issueTitle: 'Two cabinet doors arrived scratched',
  category: 'Damage',
  description: 'Surface scratches on upper doors 3 and 7.',
  reportedBy: 'Tony Alvarez',
  projectName: 'Johnson Kitchen Remodel',
  existingIssueCount: 2,
  projectManager: 'Marcus Reyes',
};

function ran(plan: ReturnType<typeof planIssueSubmitted>): Effect[] {
  assert.ok(plan.ran, `expected it to run: ${plan.ran === false ? plan.skipped : ''}`);
  return plan.effects;
}

test('WF7 performs every action §11 lists', () => {
  const types = new Set(ran(planIssueSubmitted(trigger)).map((e) => e.type));
  for (const required of [
    'AssignIssueNumber',
    'AssignIssue',
    'NotifyInternal',
    'ConfirmToReporter',
    'RecordActivity',
  ] as const) {
    assert.ok(types.has(required), `§11 WF7 requires ${required}`);
  }
});

test('issue numbers continue the project sequence', () => {
  assert.equal(issueNumberFor('BSP-2026-000184', 0), 'ISS-000184-001');
  assert.equal(issueNumberFor('BSP-2026-000184', 2), 'ISS-000184-003');
  assert.equal(issueNumberFor('BSP-2026-000184', 11), 'ISS-000184-012');
  const [assigned] = effectsOfType(ran(planIssueSubmitted(trigger)), 'AssignIssueNumber');
  assert.equal(assigned?.issueNumber, 'ISS-000184-003');
});

test('§11 the reporter is confirmed to — not just the PM', () => {
  const [confirm] = effectsOfType(ran(planIssueSubmitted(trigger)), 'ConfirmToReporter');
  assert.equal(confirm?.reporter, 'Tony Alvarez');
  assert.match(confirm?.message ?? '', /ISS-000184-003/);
});

test('a safety concern escalates AND gets a remediation task', () => {
  const effects = ran(
    planIssueSubmitted({ ...trigger, category: 'Safety Concern', issueTitle: 'Unguarded trench' }),
  );
  assert.equal(effectsOfType(effects, 'EscalateIssue').length, 1);
  assert.equal(
    effectsOfType(effects, 'CreateTask').length,
    1,
    'a hazard gets a task whether or not the reporter asked for one',
  );
});

test('a non-safety issue does not escalate, and only makes a task when asked', () => {
  const plain = ran(planIssueSubmitted(trigger));
  assert.equal(effectsOfType(plain, 'EscalateIssue').length, 0);
  assert.equal(effectsOfType(plain, 'CreateTask').length, 0);

  const withTask = ran(planIssueSubmitted({ ...trigger, requiresTask: true }));
  assert.equal(effectsOfType(withTask, 'CreateTask').length, 1);
});

test('§6.7 an unrecognised category is refused, not coerced to Other', () => {
  // Coercing would hide a drift between the reporting form and the schema —
  // including a mis-typed "Safety Concern", where the coercion matters most.
  const plan = planIssueSubmitted({ ...trigger, category: 'Vibes Problem' });
  assert.equal(plan.ran, false);
  assert.match(plan.ran === false ? plan.skipped : '', /not a §6.7 issue category/);
});

test('every §6.7 category is accepted', () => {
  for (const category of [
    'Safety Concern',
    'Damage',
    'Missing Material',
    'Incorrect Material',
    'Design Conflict',
    'Access Problem',
    'Client Request',
    'Inspection Problem',
    'Schedule Delay',
    'Equipment Problem',
    'Other',
  ]) {
    assert.ok(planIssueSubmitted({ ...trigger, category }).ran, category);
  }
});

test('WF7 does NOT notify the client — an issue is internal until a PM writes an update', () => {
  const effects = ran(planIssueSubmitted({ ...trigger, category: 'Safety Concern' }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
});

test('an unassigned issue still gets a number and a notification', () => {
  const effects = ran(planIssueSubmitted({ ...trigger, projectManager: undefined }));
  assert.equal(effectsOfType(effects, 'AssignIssue').length, 0);
  assert.equal(effectsOfType(effects, 'AssignIssueNumber').length, 1);
  assert.equal(effectsOfType(effects, 'NotifyInternal').length, 1);
});

test('WF7 refuses an issue with no project or issue id', () => {
  assert.equal(planIssueSubmitted({ ...trigger, buildsuiteProjectId: '' }).ran, false);
  assert.equal(planIssueSubmitted({ ...trigger, issueId: '' }).ran, false);
});
