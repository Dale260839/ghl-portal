import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePaymentSchedule } from '../buildsuite/payment-schedule.ts';
import {
  composeFirstInvoice,
  composeInvoices,
  describeLine,
  readyToSend,
  unconfiguredRail,
  type InvoiceContext,
} from './invoice.ts';

/** The same real shapes proven in payment-schedule.test.ts. */
const RICH = parsePaymentSchedule({
  payment_schedule: [
    {
      amount: 1773.75,
      trigger: 'Due upon signed contract — secures your spot on the schedule and covers material procurement',
      milestone: 'Contract Signing & Scheduling',
      percentage: 30,
      due_description: 'Due at contract signing',
    },
    { amount: 1773.75, milestone: 'Start of Door Installation', percentage: 30, due_description: 'Due at start of door installation' },
    { amount: 1182.5, milestone: 'Midpoint Completion', percentage: 20 },
    { amount: 1182.5, milestone: 'Project Completion', percentage: 20 },
  ],
});

const CTX: InvoiceContext = { projectCode: 'BSA-044', clientName: 'Dana Johnson' };

test('the first invoice is the deposit, from the first schedule line', () => {
  const first = composeFirstInvoice(RICH, CTX);
  assert.ok(first);
  assert.equal(first.isDeposit, true);
  assert.equal(first.position, 1);
  assert.equal(first.milestone, 'Contract Signing & Scheduling');
  assert.equal(first.amount, 1773.75);
  assert.equal(first.percentage, 30);
  assert.equal(first.clientName, 'Dana Johnson');
});

test('the deposit carries the schedule terms as its description', () => {
  const first = composeFirstInvoice(RICH, CTX);
  assert.match(first!.description, /Contract Signing & Scheduling/);
  assert.match(first!.description, /Due upon signed contract/);
});

test('every schedule line becomes its own invoice, in order', () => {
  const all = composeInvoices(RICH, CTX);
  assert.equal(all.length, 4);
  assert.deepEqual(
    all.map((i) => i.position),
    [1, 2, 3, 4],
  );
  assert.equal(all[0]!.isDeposit, true);
  assert.equal(all[1]!.isDeposit, false, 'only the first is the deposit');
});

test('the project code is stamped on every invoice, in the reference', () => {
  const all = composeInvoices(RICH, CTX);
  for (const inv of all) {
    assert.equal(inv.projectCode, 'BSA-044');
    assert.match(inv.reference, /^BSA-044 · Invoice \d of 4$/);
  }
  assert.equal(all[0]!.reference, 'BSA-044 · Invoice 1 of 4');
});

test('composition never sends — every draft is status draft', () => {
  for (const inv of composeInvoices(RICH, CTX)) {
    assert.equal(inv.status, 'draft');
  }
});

test('a pending project code produces a PENDING reference, not a crash', () => {
  const first = composeFirstInvoice(RICH, { projectCode: null, clientName: 'Dana' });
  assert.equal(first!.projectCode, null);
  assert.match(first!.reference, /^PENDING · Invoice 1 of 4$/);
});

test('a line with no amount is flagged needsAmount, not blocked', () => {
  const schedule = parsePaymentSchedule({
    payment_schedule: [{ milestone: 'Deposit', percentage: 30 }], // no amount
  });
  const first = composeFirstInvoice(schedule, CTX);
  assert.ok(first);
  assert.equal(first.amount, null);
  assert.equal(first.needsAmount, true, 'the contractor fills this in before sending');
});

test('an empty schedule yields no invoices and no first invoice', () => {
  const empty = parsePaymentSchedule({ payment_schedule: [] });
  assert.equal(composeInvoices(empty, CTX).length, 0);
  assert.equal(composeFirstInvoice(empty, CTX), null);
});

test('describeLine omits the dash when there are no terms', () => {
  const basic = parsePaymentSchedule({
    payment_schedule: [{ milestone: 'Deposit', amount: 100, percentage: 10 }],
  });
  assert.equal(describeLine(basic.first!), 'Deposit');
});

test('readyToSend requires both an amount and a real project code', () => {
  const [ready] = composeInvoices(RICH, CTX);
  assert.equal(readyToSend(ready!), true);

  const pending = composeFirstInvoice(RICH, { projectCode: null, clientName: 'Dana' });
  assert.equal(readyToSend(pending!), false, 'no code yet');

  const noAmount = composeFirstInvoice(
    parsePaymentSchedule({ payment_schedule: [{ milestone: 'X', percentage: 10 }] }),
    CTX,
  );
  assert.equal(readyToSend(noAmount!), false, 'no amount yet');
});

test('the unconfigured rail refuses rather than pretending to create', async () => {
  const first = composeFirstInvoice(RICH, CTX)!;
  const result = await unconfiguredRail.createDraft(first, {
    ghlContactId: 'c1',
    name: 'Dana',
    email: 'dana@example.com',
  });
  assert.equal(result.created, false);
  assert.match(result.created === false ? result.reason : '', /pending/i);
});
