import { test } from 'node:test';
import assert from 'node:assert/strict';

import { paymentsFor, paymentSummary } from './portal-gates.ts';
import { PAYMENT_SCHEDULE } from './data/portal-fixtures.ts';
import { PROJECTS } from './data/fixtures.ts';
import type { Project } from './data/types.ts';

const kitchen = PROJECTS.find((p) => p.buildsuiteProjectId === 'BSP-2026-000184')!;

/** A copy of the kitchen project with the portal switch forced. */
function withPortal(open: boolean): Project {
  return { ...kitchen, clientPortalEnabled: open };
}

test('§6.4 the schedule is returned in position order for its own project', () => {
  const lines = paymentsFor(withPortal(true));
  assert.ok(lines.length > 0);
  assert.deepEqual(
    lines.map((l) => l.position),
    [...lines.map((l) => l.position)].sort((a, b) => a - b),
  );
  assert.equal(lines[0]!.position, 1, 'line 1 is the deposit');
  for (const l of lines) assert.equal(l.projectId, 'BSP-2026-000184');
});

test('the portal master switch gates the whole screen', () => {
  assert.equal(paymentsFor(withPortal(false)).length, 0, 'portal off returns nothing');
});

test('a line that is not client-visible is withheld', () => {
  // Force one line private and confirm it drops out.
  const original = PAYMENT_SCHEDULE.map((l) => ({ ...l }));
  const target = PAYMENT_SCHEDULE.find((l) => l.projectId === 'BSP-2026-000184')!;
  target.clientVisible = false;
  try {
    const shown = paymentsFor(withPortal(true));
    assert.ok(!shown.some((l) => l.id === target.id), 'a withheld line is not returned');
  } finally {
    // Restore, so the shared fixture is not mutated for other tests.
    for (let i = 0; i < PAYMENT_SCHEDULE.length; i += 1) {
      Object.assign(PAYMENT_SCHEDULE[i]!, original[i]!);
    }
  }
});

test('the client type carries no cost or margin field', () => {
  const line = PAYMENT_SCHEDULE[0]!;
  const keys = Object.keys(line);
  for (const forbidden of ['cost', 'actualCost', 'margin', 'markup']) {
    assert.ok(!keys.includes(forbidden), `payment line must not carry ${forbidden}`);
  }
});

test('paymentSummary follows status: paid, outstanding, upcoming', () => {
  const s = paymentSummary(paymentsFor(withPortal(true)));
  // The fixtures: 14550 paid, 14550 invoiced (outstanding), 12125 + 7275 upcoming.
  assert.equal(s.paid, 14550);
  assert.equal(s.outstanding, 14550);
  assert.equal(s.upcoming, 19400);
  assert.equal(s.contractValue, 48500);
  // The parts reconcile to the whole.
  assert.equal(s.paid + s.outstanding + s.upcoming, s.contractValue);
});

test('an invoiced-but-unpaid line reads as outstanding, an unbilled one as upcoming', () => {
  const invoiced = paymentSummary([
    { ...PAYMENT_SCHEDULE[1]!, status: 'Invoiced', amount: 100 },
  ]);
  assert.equal(invoiced.outstanding, 100);
  assert.equal(invoiced.paid, 0);

  const notDue = paymentSummary([{ ...PAYMENT_SCHEDULE[2]!, status: 'Not due', amount: 200 }]);
  assert.equal(notDue.upcoming, 200);
  assert.equal(notDue.outstanding, 0);
});
