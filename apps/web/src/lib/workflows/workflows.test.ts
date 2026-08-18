/**
 * WF1 and WF2 asserted against §11 action by action.
 *
 * No credentials, no GHL sub-account, no network. That's the point of the
 * planner shape — "does WF1 set progress to 10%?" is a unit test rather than a
 * manual click-through in a live account.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectsOfType, type Effect } from './effects.ts';
import { DEFAULT_MILESTONES, DEFAULT_TASKS, INITIAL_PROGRESS, STAGE_PROGRESS } from './defaults.ts';
import { planNewProjectSetup, type Wf1Trigger } from './wf1-new-project.ts';
import { planStageSync, type Wf2Trigger } from './wf2-stage-sync.ts';

const handoff = {
  buildsuite_project_id: 'BSP-2026-000184',
  project_name: 'Johnson Kitchen Remodel',
  project_address: '1400 Broadway, San Antonio, TX',
  contract_amount: 48_500,
  client: { name: 'Dana Johnson', email: 'dana@example.com', phone: '+12105550137' },
};

const wf1Trigger: Wf1Trigger = {
  opportunityId: 'opp_1',
  contactId: 'contact-johnson',
  handoff,
  projectManagerUserId: 'user_marcus',
  projectExists: false,
};

function ran(plan: ReturnType<typeof planNewProjectSetup>): Effect[] {
  assert.ok(plan.ran, `expected the workflow to run, skipped: ${plan.ran === false ? plan.skipped : ''}`);
  return plan.effects;
}

// ── WF1 ──────────────────────────────────────────────────────────────────────

test('WF1 performs every action §11 lists', () => {
  const effects = ran(planNewProjectSetup(wf1Trigger));
  const types = new Set(effects.map((e) => e.type));

  for (const required of [
    'CreateProject',
    'AssociateContact',
    'AssociateOpportunity',
    'AssignProjectManager',
    'CreateMilestone',
    'CreateTask',
    'SetProgress',
    'NotifyInternal',
    'PrepareClientPortalAccess',
    'RecordActivity',
  ] as const) {
    assert.ok(types.has(required), `§11 WF1 requires ${required}`);
  }
});

test('WF1 sets Progress to 10% — the one figure §11 states outright', () => {
  const [progress] = effectsOfType(ran(planNewProjectSetup(wf1Trigger)), 'SetProgress');
  assert.equal(progress?.percentage, INITIAL_PROGRESS);
  assert.equal(INITIAL_PROGRESS, 10);
});

test('WF1 carries the §8.2 payload onto the project unchanged', () => {
  const [created] = effectsOfType(ran(planNewProjectSetup(wf1Trigger)), 'CreateProject');
  assert.equal(created?.buildsuiteProjectId, handoff.buildsuite_project_id);
  assert.equal(created?.projectName, handoff.project_name);
  assert.equal(created?.projectAddress, handoff.project_address);
  assert.equal(created?.contractAmount, handoff.contract_amount);
  assert.equal(created?.clientName, handoff.client.name);
});

test('WF1 seeds milestones in sequence and tasks alongside', () => {
  const effects = ran(planNewProjectSetup(wf1Trigger));
  const milestones = effectsOfType(effects, 'CreateMilestone');
  assert.equal(milestones.length, DEFAULT_MILESTONES.length);
  assert.deepEqual(
    milestones.map((m) => m.sequence),
    DEFAULT_MILESTONES.map((_, i) => i + 1),
  );
  assert.equal(effectsOfType(effects, 'CreateTask').length, DEFAULT_TASKS.length);
});

test('WF1 does NOT notify the client — §11 lists no client notification', () => {
  const effects = ran(planNewProjectSetup(wf1Trigger));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
});

test('WF1 refuses a payload with no valid shared key rather than inventing one', () => {
  const plan = planNewProjectSetup({
    ...wf1Trigger,
    handoff: { ...handoff, buildsuite_project_id: 'not-an-id' },
  });
  assert.equal(plan.ran, false);
  assert.match(plan.ran === false ? plan.skipped : '', /buildsuite_project_id/);
});

test('WF1 refuses an incomplete payload', () => {
  const plan = planNewProjectSetup({ ...wf1Trigger, handoff: { project_name: 'Orphan' } });
  assert.equal(plan.ran, false);
});

test('WF1 is idempotent — a re-fired handoff does not duplicate milestones', () => {
  const plan = planNewProjectSetup({ ...wf1Trigger, projectExists: true });
  const effects = ran(plan);
  assert.equal(effectsOfType(effects, 'CreateMilestone').length, 0);
  assert.equal(effectsOfType(effects, 'CreateTask').length, 0);
  assert.equal(effectsOfType(effects, 'CreateProject').length, 0);
  assert.equal(effectsOfType(effects, 'RecordActivity').length, 1);
});

test('WF1 flags an unassigned PM instead of leaving it silent', () => {
  const plan = planNewProjectSetup({ ...wf1Trigger, projectManagerUserId: undefined });
  const effects = ran(plan);
  assert.equal(effectsOfType(effects, 'AssignProjectManager').length, 0);
  // An unassigned project has nobody to receive the review queue, which breaks
  // the §3.2 approval path — so it has to be noisy.
  assert.ok(
    effectsOfType(effects, 'NotifyInternal').some((n) => /without a project manager/.test(n.message)),
  );
});

// ── WF2 ──────────────────────────────────────────────────────────────────────

const wf2Trigger: Wf2Trigger = {
  buildsuiteProjectId: 'BSP-2026-000184',
  fromStage: 'Scheduled',
  toStage: 'In Progress',
  contactId: 'contact-johnson',
  projectName: 'Johnson Kitchen Remodel',
  milestones: [
    { milestoneName: 'Planning', sequence: 1 },
    { milestoneName: 'In Progress', sequence: 2 },
    { milestoneName: 'Inspection', sequence: 3 },
  ],
};

test('WF2 performs every action §11 lists', () => {
  const effects = ran(planStageSync(wf2Trigger));
  const types = new Set(effects.map((e) => e.type));
  for (const required of [
    'UpdateProjectStage',
    'SetProgress',
    'SetCurrentMilestone',
    'SetNextMilestone',
    'NotifyTeam',
  ] as const) {
    assert.ok(types.has(required), `§11 WF2 requires ${required}`);
  }
});

test('WF2 will not act without the shared key — no name matching (§3.6)', () => {
  for (const id of [null, '']) {
    const plan = planStageSync({ ...wf2Trigger, buildsuiteProjectId: id });
    assert.equal(plan.ran, false);
    assert.match(plan.ran === false ? plan.skipped : '', /BuildSuite Project ID/);
  }
});

test('WF2 rejects a stage that is not in the §7 pipeline', () => {
  const plan = planStageSync({ ...wf2Trigger, toStage: 'Awaiting Vibes' });
  assert.equal(plan.ran, false);
  assert.match(plan.ran === false ? plan.skipped : '', /Project Lifecycle/);
});

test('WF2 is idempotent — a re-fired webhook for the same stage does nothing', () => {
  const plan = planStageSync({ ...wf2Trigger, fromStage: 'In Progress', toStage: 'In Progress' });
  assert.equal(plan.ran, false);
  // The point: no second NotifyClient for a stage the client already heard about.
});

test('WF2 sets current and next from the project\'s own milestone list', () => {
  const effects = ran(planStageSync(wf2Trigger));
  assert.equal(effectsOfType(effects, 'SetCurrentMilestone')[0]?.milestoneName, 'In Progress');
  assert.equal(effectsOfType(effects, 'SetNextMilestone')[0]?.milestoneName, 'Inspection');
});

test('WF2 omits Next Milestone at the end of the list rather than inventing one', () => {
  const effects = ran(planStageSync({ ...wf2Trigger, toStage: 'Inspection', fromStage: 'In Progress' }));
  assert.equal(effectsOfType(effects, 'SetNextMilestone').length, 0);
});

test('WF2 falls back to the stage name when no milestone matches', () => {
  const effects = ran(planStageSync({ ...wf2Trigger, milestones: [], toStage: 'Permitting' }));
  assert.equal(effectsOfType(effects, 'SetCurrentMilestone')[0]?.milestoneName, 'Permitting');
});

test('On Hold and Canceled do NOT move the progress bar', () => {
  for (const stage of ['On Hold', 'Canceled'] as const) {
    const effects = ran(planStageSync({ ...wf2Trigger, toStage: stage }));
    assert.equal(
      effectsOfType(effects, 'SetProgress').length,
      0,
      `${stage} must not reset progress — a paused project at 65% has not regressed to 0`,
    );
    assert.equal(effectsOfType(effects, 'UpdateProjectStage')[0]?.stage, stage);
  }
});

test('progress never decreases across the sequential stages', () => {
  const sequential = Object.entries(STAGE_PROGRESS).filter(([, v]) => v >= 0);
  let previous = -1;
  for (const [stage, value] of sequential) {
    assert.ok(value >= previous, `${stage} (${value}) went backwards from ${previous}`);
    previous = value;
  }
  assert.equal(STAGE_PROGRESS.Completed, 100, '§11 WF8 sets 100% at Completed');
});

test('WF2 notifies the client only at the stages on the list', () => {
  const notified = ran(planStageSync({ ...wf2Trigger, toStage: 'Completed' }));
  assert.equal(effectsOfType(notified, 'NotifyClient').length, 1);

  const quiet = ran(planStageSync({ ...wf2Trigger, toStage: 'Permitting' }));
  assert.equal(effectsOfType(quiet, 'NotifyClient').length, 0);
});

test('WF2 cannot notify a client that does not exist', () => {
  const effects = ran(planStageSync({ ...wf2Trigger, contactId: null, toStage: 'Completed' }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  assert.equal(effectsOfType(effects, 'NotifyTeam').length, 1, 'the team is still told');
});

test('every planned effect carries the shared key (§5)', () => {
  const all = [...ran(planNewProjectSetup(wf1Trigger)), ...ran(planStageSync(wf2Trigger))];
  for (const effect of all) {
    assert.equal(
      effect.buildsuiteProjectId,
      'BSP-2026-000184',
      `${effect.type} lost the join key`,
    );
  }
});
