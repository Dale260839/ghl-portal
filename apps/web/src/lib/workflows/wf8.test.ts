/**
 * WF8 — Project Completed, asserted against §11.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectsOfType, type Effect } from './effects.ts';
import { DEFAULT_WARRANTY_MONTHS, addMonths, planProjectCompleted, type Wf8Trigger } from './wf8-project-completed.ts';

const trigger: Wf8Trigger = {
  buildsuiteProjectId: 'BSP-2026-000168',
  projectName: 'Ortega Deck & Pergola',
  contactId: 'contact-ortega',
  completedOn: '2026-08-14',
  remainingBalance: 3570,
  openPunchListItems: 0,
  clientPortalEnabled: true,
};

function ran(plan: ReturnType<typeof planProjectCompleted>): Effect[] {
  assert.ok(plan.ran, `expected it to run: ${plan.ran === false ? plan.skipped : ''}`);
  return plan.effects;
}

test('§11 WF8 sets progress to 100%', () => {
  const [progress] = effectsOfType(ran(planProjectCompleted(trigger)), 'SetProgress');
  assert.equal(progress?.percentage, 100);
});

test('§11 WF8 moves the project into Warranty', () => {
  const [stage] = effectsOfType(ran(planProjectCompleted(trigger)), 'UpdateProjectStage');
  assert.equal(stage?.stage, 'Warranty');
});

test('warranty dates are recorded BEFORE the stage moves to Warranty', () => {
  // A project sitting in Warranty with no warranty period is a support call.
  const effects = ran(planProjectCompleted(trigger));
  const warrantyIndex = effects.findIndex(
    (e) => e.type === 'RecordActivity' && e.activity.startsWith('Warranty '),
  );
  const stageIndex = effects.findIndex((e) => e.type === 'UpdateProjectStage');
  assert.ok(warrantyIndex >= 0 && stageIndex >= 0);
  assert.ok(warrantyIndex < stageIndex, 'warranty period must be set first');
});

test('the warranty period defaults to twelve months and is overridable', () => {
  assert.equal(DEFAULT_WARRANTY_MONTHS, 12);
  const [activity] = effectsOfType(ran(planProjectCompleted(trigger)), 'RecordActivity');
  assert.match(activity?.activity ?? '', /2027-08-14/);

  const custom = ran(planProjectCompleted({ ...trigger, warrantyMonths: 24 }));
  assert.match(effectsOfType(custom, 'RecordActivity')[0]?.activity ?? '', /2028-08-14/);
});

test('month arithmetic clamps rather than rolling over', () => {
  // 31 Jan + 1 month is 28 Feb, not 3 March.
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29', 'leap year');
  assert.equal(addMonths('2026-08-31', 12), '2027-08-31');
  assert.equal(addMonths('2026-12-15', 12), '2027-12-15');
});

test('open punch-list items raise a task and tell the PM', () => {
  const effects = ran(planProjectCompleted({ ...trigger, openPunchListItems: 3 }));
  assert.equal(effectsOfType(effects, 'CreateTask').length, 1);
  assert.ok(
    effectsOfType(effects, 'NotifyInternal').some((n) => /3 open punch-list/.test(n.message)),
  );
});

test('a clean completion raises no punch-list task', () => {
  assert.equal(effectsOfType(ran(planProjectCompleted(trigger)), 'CreateTask').length, 0);
});

test('an outstanding balance prompts the final invoice', () => {
  assert.ok(
    effectsOfType(ran(planProjectCompleted(trigger)), 'NotifyInternal').some((n) =>
      /final invoice/.test(n.message),
    ),
  );
  const settled = ran(planProjectCompleted({ ...trigger, remainingBalance: 0 }));
  assert.ok(!effectsOfType(settled, 'NotifyInternal').some((n) => /final invoice/.test(n.message)));
});

test('the client is told, and the message carries the warranty end date', () => {
  const [notify] = effectsOfType(ran(planProjectCompleted(trigger)), 'NotifyClient');
  assert.equal(notify?.contactId, 'contact-ortega');
  assert.match(notify?.message ?? '', /2027-08-14/);
});

test('§9.1 a disabled portal means no client notification', () => {
  const effects = ran(planProjectCompleted({ ...trigger, clientPortalEnabled: false }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  // The project still completes — only the telling is withheld.
  assert.equal(effectsOfType(effects, 'SetProgress')[0]?.percentage, 100);
});

test('no contact means no client notification', () => {
  const effects = ran(planProjectCompleted({ ...trigger, contactId: null }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
});

test('WF8 refuses a project with no id', () => {
  assert.equal(planProjectCompleted({ ...trigger, buildsuiteProjectId: '' }).ran, false);
});
