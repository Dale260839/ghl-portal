/**
 * WF3, WF4, and the executor.
 *
 * Together these are the §3.2 publishing path — the rule the whole product rests
 * on. Field submits → PM reviews and edits → PM publishes → client sees. Every
 * assertion below is about keeping that path from being short-circuited.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { effectsOfType, type Effect } from './effects.ts';
import { execute, describe as describeResult } from './executor.ts';
import { RecordingPorts, type EffectHandlers } from './ports.ts';
import { planFieldUpdateSubmitted, type Wf3Trigger } from './wf3-update-submitted.ts';
import { planFieldUpdateApproved, type Wf4Trigger } from './wf4-update-approved.ts';

const wf3Trigger: Wf3Trigger = {
  buildsuiteProjectId: 'BSP-2026-000184',
  updateId: 'du-1',
  submittedBy: 'Tony Alvarez',
  projectName: 'Johnson Kitchen Remodel',
};

const wf4Trigger: Wf4Trigger = {
  buildsuiteProjectId: 'BSP-2026-000184',
  updateId: 'du-1',
  managerApprovalStatus: 'Approved & Published',
  clientSummary: 'Cabinet installation is underway.',
  contactId: 'contact-johnson',
  projectName: 'Johnson Kitchen Remodel',
  today: '2026-08-06',
  clientPortalEnabled: true,
};

function ran(plan: ReturnType<typeof planFieldUpdateSubmitted>): Effect[] {
  assert.ok(plan.ran, `expected the workflow to run: ${plan.ran === false ? plan.skipped : ''}`);
  return plan.effects;
}

// ── WF3 ──────────────────────────────────────────────────────────────────────

test('WF3 performs every action §11 lists', () => {
  const types = new Set(ran(planFieldUpdateSubmitted(wf3Trigger)).map((e) => e.type));
  for (const required of ['SetManagerApprovalStatus', 'AddToReviewQueue', 'NotifyInternal'] as const) {
    assert.ok(types.has(required), `§11 WF3 requires ${required}`);
  }
});

test('WF3 sets Pending — a submission is a request, not an approval', () => {
  const [status] = effectsOfType(ran(planFieldUpdateSubmitted(wf3Trigger)), 'SetManagerApprovalStatus');
  assert.equal(status?.status, 'Pending');
});

test('§3.2 WF3 does NOT notify the client — the loop stops at the PM', () => {
  const effects = ran(planFieldUpdateSubmitted(wf3Trigger));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  assert.equal(effectsOfType(effects, 'SetClientVisible').length, 0);
  assert.equal(effectsOfType(effects, 'PublishClientSummary').length, 0);
  assert.equal(effectsOfType(effects, 'AddToPortalFeed').length, 0);
});

test('WF3 raises an Issue when a blocker is reported', () => {
  const effects = ran(planFieldUpdateSubmitted({ ...wf3Trigger, blocker: 'Panel not delivered' }));
  const [issue] = effectsOfType(effects, 'CreateIssue');
  assert.equal(issue?.description, 'Panel not delivered');
  assert.equal(issue?.priority, 'Normal');
});

test('WF3 escalates a safety blocker to Urgent with the §6.7 category', () => {
  const effects = ran(
    planFieldUpdateSubmitted({ ...wf3Trigger, blocker: 'Unguarded trench', safetyConcern: true }),
  );
  const [issue] = effectsOfType(effects, 'CreateIssue');
  assert.equal(issue?.priority, 'Urgent');
  assert.equal(issue?.category, 'Safety Concern');
});

test('WF3 raises no Issue for a blank blocker', () => {
  for (const blocker of [undefined, '', '   ']) {
    const effects = ran(planFieldUpdateSubmitted({ ...wf3Trigger, blocker }));
    assert.equal(effectsOfType(effects, 'CreateIssue').length, 0, `blocker=${String(blocker)}`);
  }
});

test('WF3 flags client action when the field says a decision is needed', () => {
  const effects = ran(planFieldUpdateSubmitted({ ...wf3Trigger, clientDecisionNeeded: true }));
  assert.equal(effectsOfType(effects, 'SetClientActionRequired')[0]?.required, true);
});

// ── WF4 ──────────────────────────────────────────────────────────────────────

test('WF4 performs every action §11 lists', () => {
  const types = new Set(ran(planFieldUpdateApproved(wf4Trigger)).map((e) => e.type));
  for (const required of [
    'SetClientVisible',
    'PublishClientSummary',
    'SetProjectLastUpdated',
    'NotifyClient',
    'AddToPortalFeed',
  ] as const) {
    assert.ok(types.has(required), `§11 WF4 requires ${required}`);
  }
});

test('§10 WF4 does NOT fire on "Approved Internally"', () => {
  // The single easiest rule in the system to get wrong — two of the four
  // approval values contain the word "Approved", one reaches a client.
  const plan = planFieldUpdateApproved({
    ...wf4Trigger,
    managerApprovalStatus: 'Approved Internally',
  });
  assert.equal(plan.ran, false);
  assert.match(plan.ran === false ? plan.skipped : '', /nothing is published/);
});

test('§10 WF4 does not fire on Pending or Returned either', () => {
  for (const status of ['Pending', 'Returned'] as const) {
    assert.equal(planFieldUpdateApproved({ ...wf4Trigger, managerApprovalStatus: status }).ran, false);
  }
});

test('WF4 publishes the PM-edited summary, and nothing else', () => {
  const [published] = effectsOfType(ran(planFieldUpdateApproved(wf4Trigger)), 'PublishClientSummary');
  assert.equal(published?.clientSummary, wf4Trigger.clientSummary);
  assert.equal(published?.publishDate, '2026-08-06');
  // Internal notes are not a field on the trigger at all — they cannot be
  // published because they are never passed in.
  assert.ok(!('internalNotes' in wf4Trigger));
});

test('WF4 refuses to publish an empty summary', () => {
  for (const summary of ['', '   ']) {
    const plan = planFieldUpdateApproved({ ...wf4Trigger, clientSummary: summary });
    assert.equal(plan.ran, false);
    assert.match(plan.ran === false ? plan.skipped : '', /empty/);
  }
});

test('§9.1 WF4 respects the portal master switch at publish time', () => {
  const effects = ran(planFieldUpdateApproved({ ...wf4Trigger, clientPortalEnabled: false }));
  assert.equal(effectsOfType(effects, 'AddToPortalFeed').length, 0);
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  // The record still updates — it just isn't surfaced. And the PM is told.
  assert.equal(effectsOfType(effects, 'SetClientVisible').length, 1);
  assert.ok(
    effectsOfType(effects, 'NotifyInternal').some((n) => /portal is disabled/.test(n.message)),
  );
});

test('WF4 honours the Notify Client checkbox without withholding the update', () => {
  const effects = ran(planFieldUpdateApproved({ ...wf4Trigger, notifyClient: false }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  assert.equal(effectsOfType(effects, 'AddToPortalFeed').length, 1, 'still appears in the portal');
});

test('WF4 cannot notify a client that does not exist', () => {
  const effects = ran(planFieldUpdateApproved({ ...wf4Trigger, contactId: null }));
  assert.equal(effectsOfType(effects, 'NotifyClient').length, 0);
  assert.equal(effectsOfType(effects, 'PublishClientSummary').length, 1);
});

// ── The loop, end to end ─────────────────────────────────────────────────────

test('§3.2 the full loop: submit → review → publish, and no shortcut exists', async () => {
  const ports = new RecordingPorts();

  const submitted = await execute(planFieldUpdateSubmitted(wf3Trigger), ports.handlers);
  assert.equal(submitted.status, 'ok');
  assert.equal(ports.ofType('NotifyClient').length, 0, 'the client hears nothing at submission');
  assert.equal(ports.ofType('SetManagerApprovalStatus')[0]?.status, 'Pending');

  // A PM approving internally must still not reach the client.
  const internal = await execute(
    planFieldUpdateApproved({ ...wf4Trigger, managerApprovalStatus: 'Approved Internally' }),
    ports.handlers,
  );
  assert.equal(internal.status, 'skipped');
  assert.equal(ports.ofType('NotifyClient').length, 0);

  // Only an explicit publish gets there.
  const published = await execute(planFieldUpdateApproved(wf4Trigger), ports.handlers);
  assert.equal(published.status, 'ok');
  assert.equal(ports.ofType('NotifyClient').length, 1);
  assert.equal(ports.ofType('AddToPortalFeed').length, 1);
});

// ── Executor ─────────────────────────────────────────────────────────────────

test('executor applies effects in the order the planner emitted them', async () => {
  const ports = new RecordingPorts();
  const plan = planFieldUpdateApproved(wf4Trigger);
  await execute(plan, ports.handlers);
  assert.deepEqual(
    ports.applied.map((e) => e.type),
    plan.ran ? plan.effects.map((e) => e.type) : [],
  );
});

test('executor reports a skipped plan without applying anything', async () => {
  const ports = new RecordingPorts();
  const result = await execute(
    planFieldUpdateApproved({ ...wf4Trigger, managerApprovalStatus: 'Pending' }),
    ports.handlers,
  );
  assert.equal(result.status, 'skipped');
  assert.equal(ports.applied.length, 0);
});

test('executor stops at the first failure and reports what was already applied', async () => {
  const applied: Effect[] = [];
  const handlers = new Proxy({} as EffectHandlers, {
    get: (_t, prop) => (effect: Effect) => {
      if (prop === 'SetProjectLastUpdated') throw new Error('GHL 503');
      applied.push(effect);
    },
  });

  const result = await execute(planFieldUpdateApproved(wf4Trigger), handlers);
  assert.equal(result.status, 'failed');
  if (result.status !== 'failed') return;

  assert.equal(result.failedOn.type, 'SetProjectLastUpdated');
  assert.equal(result.error.message, 'GHL 503');
  // A retry needs to know these already happened.
  assert.deepEqual(
    result.applied.map((e) => e.type),
    ['SetClientVisible', 'PublishClientSummary'],
  );
  assert.equal(applied.length, 2, 'no effect after the failure was applied');
});

test('executor awaits async handlers rather than firing and forgetting', async () => {
  const order: string[] = [];
  const handlers = new Proxy({} as EffectHandlers, {
    get: (_t, prop) => async (_e: Effect) => {
      await new Promise((r) => setTimeout(r, 1));
      order.push(String(prop));
    },
  });

  await execute(planFieldUpdateApproved(wf4Trigger), handlers);
  assert.deepEqual(order.slice(0, 2), ['SetClientVisible', 'PublishClientSummary']);
});

test('describe summarises without leaking effect payloads into logs', async () => {
  const ports = new RecordingPorts();
  const line = describeResult(await execute(planFieldUpdateApproved(wf4Trigger), ports.handlers));
  assert.match(line, /applied \d+ effect/);
  assert.ok(!line.includes(wf4Trigger.clientSummary));
});
