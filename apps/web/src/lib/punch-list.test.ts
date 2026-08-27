/**
 * §6.9 / Artifact 90 punch list — the helpers, the gate, and the §9.3 drop.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PUNCH_DONE_STATUSES, punchItemDone, punchListProgress } from './data/types.ts';
import type { PunchListItem } from './data/types.ts';
import { punchListFor } from './portal-gates.ts';
import {
  allPunchItemsFor,
  openPunchItemCount,
  openPunchItems,
  wf8TriggerFor,
} from './punch-list.ts';
import { planProjectCompleted } from './workflows/wf8-project-completed.ts';
import { PUNCH_LIST } from './data/portal-fixtures.ts';
import { PROJECTS } from './data/fixtures.ts';

const kitchen = PROJECTS.find((p) => p.buildsuiteProjectId === 'BSP-2026-000184')!;
const retail = PROJECTS.find((p) => p.buildsuiteProjectId === 'BSP-2026-000212')!;

function item(over: Partial<PunchListItem> = {}): PunchListItem {
  return {
    id: 'pl-x',
    projectId: 'BSP-2026-000184',
    itemNumber: '001',
    title: 'A punch item',
    location: 'Main Kitchen',
    description: '',
    status: 'Open',
    reportedBy: 'Marcus Reyes',
    raisedByClient: false,
    targetDate: '',
    completedDate: '',
    internalNotes: '',
    clientVisible: true,
    ...over,
  };
}

// ── The helpers ──────────────────────────────────────────────────────────────

test('Artifact 90 Completed and Verified are done; Open and Scheduled are not', () => {
  assert.equal(punchItemDone(item({ status: 'Completed' })), true);
  assert.equal(punchItemDone(item({ status: 'Verified' })), true);
  assert.equal(punchItemDone(item({ status: 'Open' })), false);
  assert.equal(punchItemDone(item({ status: 'Scheduled' })), false);
});

test('progress counts done vs remaining and rounds the percentage', () => {
  const p = punchListProgress([
    item({ status: 'Verified' }),
    item({ status: 'Completed' }),
    item({ status: 'Scheduled' }),
    item({ status: 'Open' }),
  ]);
  assert.deepEqual(p, { total: 4, done: 2, remaining: 2, percent: 50 });
});

test('an empty punch list is 100% complete, never a divide-by-zero', () => {
  // A client at handoff with a clean list should read done, not 0% or NaN.
  assert.deepEqual(punchListProgress([]), { total: 0, done: 0, remaining: 0, percent: 100 });
});

test('the percentage rounds rather than truncates', () => {
  // 1 of 3 = 33.33 → 33
  const p = punchListProgress([
    item({ status: 'Verified' }),
    item({ status: 'Open' }),
    item({ status: 'Open' }),
  ]);
  assert.equal(p.percent, 33);
});

test('PUNCH_DONE_STATUSES contains exactly the finished states', () => {
  assert.deepEqual([...PUNCH_DONE_STATUSES].sort(), ['Completed', 'Verified']);
});

// ── The gate ───────────────────────────────────────────────────────────────

test('§9.1 punchListFor returns nothing when the portal is off', () => {
  assert.equal(retail.clientPortalEnabled, false);
  assert.deepEqual(punchListFor(retail), []);
});

test('§9.1 punchListFor returns only client-visible items, withholding the rest', () => {
  const visible = punchListFor(kitchen);
  const withheldInFixtures = PUNCH_LIST.filter(
    (p) => p.projectId === kitchen.buildsuiteProjectId && !p.clientVisible,
  );
  assert.ok(withheldInFixtures.length > 0, 'fixtures must include at least one withheld item');
  // Every withheld item's number is absent from what the client can see.
  for (const w of withheldInFixtures) {
    assert.ok(
      !visible.some((v) => v.itemNumber === w.itemNumber),
      `withheld PL-${w.itemNumber} leaked to the client`,
    );
  }
});

test('§9.3 the client projection drops internalNotes by construction', () => {
  const serialized = JSON.stringify(punchListFor(kitchen));
  assert.ok(!serialized.toLowerCase().includes('"internalnotes"'), 'internalNotes key present');
  for (const p of PUNCH_LIST) {
    if (p.internalNotes === '') continue;
    assert.ok(!serialized.includes(p.internalNotes), `internal note leaked: PL-${p.itemNumber}`);
  }
});

test('the client list is sorted by item number', () => {
  const nums = punchListFor(kitchen).map((p) => p.itemNumber);
  assert.deepEqual(nums, [...nums].sort());
});

// ── Fixture invariants ───────────────────────────────────────────────────────

test('punch item numbers are unique per project', () => {
  const seen = new Set<string>();
  for (const p of PUNCH_LIST) {
    const key = `${p.projectId}/${p.itemNumber}`;
    assert.ok(!seen.has(key), `duplicate punch item number ${key}`);
    seen.add(key);
  }
});

test('a done fixture item records the date it was completed', () => {
  for (const p of PUNCH_LIST.filter(punchItemDone)) {
    assert.notEqual(p.completedDate, '', `PL-${p.itemNumber} is done but has no completion date`);
  }
});

test('at least one fixture item is attributed to the client', () => {
  // The "You raised this" badge depends on this flag being honest.
  assert.ok(PUNCH_LIST.some((p) => p.raisedByClient), 'expected a client-raised item');
});

// ── §11 the WF8 wiring ───────────────────────────────────────────────────────

test('§11 the open count includes items the client was never shown', () => {
  // The whole reason WF8 asks for this number: withheld snags are still snags.
  // Counting only client-visible items would let a project close with real work
  // outstanding and no review task raised.
  const all = allPunchItemsFor(kitchen.buildsuiteProjectId);
  const clientSide = punchListFor(kitchen);
  assert.ok(all.length > clientSide.length, 'fixtures must withhold at least one item');

  const withheldOpen = all.filter((p) => !p.clientVisible && !punchItemDone(p));
  assert.ok(withheldOpen.length > 0, 'fixtures should have a withheld OPEN item');

  const counted = openPunchItemCount(kitchen.buildsuiteProjectId);
  const clientVisibleOpen = all.filter((p) => p.clientVisible && !punchItemDone(p)).length;
  assert.equal(counted, clientVisibleOpen + withheldOpen.length);
  assert.ok(counted > clientVisibleOpen, 'the internal count must exceed the client-visible one');
});

test('§11 openPunchItems excludes Completed and Verified', () => {
  const open = openPunchItems([
    item({ status: 'Open' }),
    item({ status: 'Scheduled' }),
    item({ status: 'Completed' }),
    item({ status: 'Verified' }),
  ]);
  assert.deepEqual(open.map((p) => p.status), ['Open', 'Scheduled']);
});

test('§11 wf8TriggerFor computes openPunchListItems rather than being handed it', () => {
  const trigger = wf8TriggerFor(kitchen, '2026-09-30', [
    item({ status: 'Open' }),
    item({ status: 'Verified' }),
    item({ status: 'Scheduled' }),
  ]);
  assert.equal(trigger.openPunchListItems, 2);
  assert.equal(trigger.buildsuiteProjectId, kitchen.buildsuiteProjectId);
  assert.equal(trigger.completedOn, '2026-09-30');
  assert.equal(trigger.remainingBalance, kitchen.remainingBalance);
  assert.equal(trigger.clientPortalEnabled, kitchen.clientPortalEnabled);
});

test('§11 a derived trigger drives WF8 to raise the punch-list review task', () => {
  // End to end: real fixture punch list -> trigger -> plan -> effects.
  const trigger = wf8TriggerFor(kitchen, '2026-09-30');
  const plan = planProjectCompleted(trigger);
  assert.equal(plan.ran, true);
  const effects = plan.ran ? plan.effects : [];

  const review = effects.filter((e) => e.type === 'CreateTask');
  assert.equal(review.length, 1, 'expected one punch-list review task');
  assert.ok(
    review[0] !== undefined && 'taskName' in review[0] && review[0].taskName.includes('Punch list review'),
  );
  // The task names the real count, not a placeholder.
  assert.ok(
    'taskName' in review[0]! &&
      review[0]!.taskName.includes(String(openPunchItemCount(kitchen.buildsuiteProjectId))),
  );
});

test('§11 a project with nothing outstanding raises no review task', () => {
  const trigger = wf8TriggerFor(kitchen, '2026-09-30', [
    item({ status: 'Verified' }),
    item({ status: 'Completed' }),
  ]);
  assert.equal(trigger.openPunchListItems, 0);
  const plan = planProjectCompleted(trigger);
  const effects = plan.ran ? plan.effects : [];
  assert.equal(effects.filter((e) => e.type === 'CreateTask').length, 0);
});

test('D4 §5 the trigger never decides completion — the date is passed in', () => {
  // Rule 1: GHL owns stage movement. Two different dates in, two different
  // dates out, and nothing here consults a clock.
  assert.equal(wf8TriggerFor(kitchen, '2026-09-01').completedOn, '2026-09-01');
  assert.equal(wf8TriggerFor(kitchen, '2027-01-15').completedOn, '2027-01-15');
});
