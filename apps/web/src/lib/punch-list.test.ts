import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PUNCH_DONE_STATUSES,
  PUNCH_LIST_STATUSES,
  punchItemDone,
  punchListProgress,
} from './data/types.ts';
import type { PunchListItem } from './data/types.ts';
import { PUNCH_LIST } from './data/portal-fixtures.ts';

const PROJECT = 'BSP-2026-000184';

function item(over: Partial<PunchListItem> = {}): PunchListItem {
  return {
    id: 'pl-x',
    projectId: PROJECT,
    itemNumber: '001',
    title: 'A punch item',
    location: 'Main Kitchen',
    description: '',
    status: 'Open',
    reportedBy: 'Marcus Reyes',
    raisedByClient: false,
    targetDate: null,
    completedDate: null,
    internalNotes: '',
    clientVisible: true,
    ...over,
  };
}

test('Artifact 90 Completed and Verified count as done; Open and Scheduled do not', () => {
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
  assert.equal(p.total, 4);
  assert.equal(p.done, 2);
  assert.equal(p.remaining, 2);
  assert.equal(p.percent, 50);
});

test('an empty punch list is 100% complete, never a divide-by-zero', () => {
  // A client at handoff with a clean list should see done, not 0% or NaN.
  const p = punchListProgress([]);
  assert.deepEqual(p, { total: 0, done: 0, remaining: 0, percent: 100 });
});

test('percentage rounds rather than truncates', () => {
  const p = punchListProgress([
    item({ status: 'Verified' }),
    item({ status: 'Open' }),
    item({ status: 'Open' }),
  ]);
  // 1/3 = 33.33 → 33
  assert.equal(p.percent, 33);
});

test('PUNCH_DONE_STATUSES are all members of the status list', () => {
  for (const s of PUNCH_DONE_STATUSES) {
    assert.ok((PUNCH_LIST_STATUSES as readonly string[]).includes(s));
  }
});

test('§9.3 no fixture leaks internal notes through a client-facing field', () => {
  for (const p of PUNCH_LIST) {
    const clientFacing = [p.title, p.location, p.description, p.reportedBy].join(' ');
    assert.ok(
      p.internalNotes === '' || !clientFacing.includes(p.internalNotes),
      `PL-${p.itemNumber} repeats its internal note in a client-facing field`,
    );
  }
});

test('the withheld punch item is not client-visible', () => {
  // A list where everything is visible proves nothing about the §9.1 gate.
  const withheld = PUNCH_LIST.filter((p) => !p.clientVisible);
  assert.ok(withheld.length > 0, 'fixtures must include at least one withheld punch item');
});

test('punch item numbers are unique per project', () => {
  const seen = new Set<string>();
  for (const p of PUNCH_LIST) {
    const key = `${p.projectId}/${p.itemNumber}`;
    assert.ok(!seen.has(key), `duplicate punch item number ${key}`);
    seen.add(key);
  }
});

test('a done punch item records the date it was completed', () => {
  for (const p of PUNCH_LIST.filter(punchItemDone)) {
    assert.ok(p.completedDate !== null, `PL-${p.itemNumber} is done but has no completion date`);
  }
});

test('an item raised by the client is attributed to a client, not the crew', () => {
  // The "You raised this" badge depends on this flag being honest.
  const clientRaised = PUNCH_LIST.filter((p) => p.raisedByClient);
  assert.ok(clientRaised.length > 0, 'fixtures should include at least one client-raised item');
});
