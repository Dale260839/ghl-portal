import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientPaymentSchedule,
  clientScheduleSummary,
  type IssuedInvoiceRef,
} from './client-payment-schedule.ts';
import { draftsForProposal, parsePaymentSchedule, type ScheduleLine } from './payment-schedule.ts';

/**
 * The homeowner's payment schedule.
 *
 * Every figure a homeowner sees must come from the contract they signed or an
 * invoice actually issued to them — never from the contractor's draft.
 */

function line(order: number, over: Partial<ScheduleLine> = {}): ScheduleLine {
  return {
    order,
    title: `Stage ${order}`,
    percent: null,
    amount: null,
    description: `terms ${order}`,
    raw: `- raw ${order}`,
    ...over,
  };
}

function invoice(id: string, over: Partial<IssuedInvoiceRef> = {}): IssuedInvoiceRef {
  return { id, status: 'sent', total: 1000, amountDue: 1000, ...over };
}

// ── Where each number comes from ─────────────────────────────────────────────

test('an unbilled line shows the figure from the signed contract', () => {
  const [stated, computed] = clientPaymentSchedule({
    lines: [line(1, { amount: 1773.75 }), line(2, { percent: 30 })],
    contractTotal: 30745,
    links: [],
    invoices: [],
  });

  assert.equal(stated!.amount, 1773.75);
  assert.equal(stated!.basis, 'contract');
  // Percent of the contract total, rounded to cents — the same arithmetic the
  // contractor's review screen uses, so the two can never disagree.
  assert.equal(computed!.amount, 9223.5);
  assert.equal(computed!.basis, 'contract');
  assert.equal(computed!.state, 'upcoming');
});

test('a line with no amount and no computable figure says so — never zero', () => {
  // 29 of 33 schedules state no money. Zero is a number a homeowner could read
  // as "nothing owed"; null is not.
  const [l] = clientPaymentSchedule({
    lines: [line(1, { percent: 50 })],
    contractTotal: null,
    links: [],
    invoices: [],
  });
  assert.equal(l!.amount, null);
  assert.equal(l!.basis, null);
});

test('a billed line shows the ISSUED invoice total, not the contract figure', () => {
  const [l] = clientPaymentSchedule({
    lines: [line(1, { percent: 30 })],
    contractTotal: 30745,
    links: [{ lineOrder: 1, externalId: 'inv-1' }],
    invoices: [invoice('inv-1', { total: 9500, amountDue: 9500 })],
  });
  assert.equal(l!.amount, 9500);
  assert.equal(l!.basis, 'invoice');
  assert.equal(l!.state, 'due');
});

test('a draft that was never issued changes nothing the homeowner sees', () => {
  // THE rule. A draft linked to an invoice that is not in the issued list — a
  // GoHighLevel draft, or a void — must not mark the line billed or move its
  // figure. The homeowner sees the contract, exactly as if no draft existed.
  const without = clientPaymentSchedule({
    lines: [line(1, { percent: 30 })],
    contractTotal: 30745,
    links: [],
    invoices: [],
  });
  const withDraft = clientPaymentSchedule({
    lines: [line(1, { percent: 30 })],
    contractTotal: 30745,
    links: [{ lineOrder: 1, externalId: 'inv-draft-not-issued' }],
    invoices: [],
  });
  assert.deepEqual(withDraft, without);
});

test('nothing from the stored draft itself can reach the homeowner', () => {
  // The link type carries only the line and the invoice id. There is no field
  // through which a draft's amount, title or notes could travel — and extra
  // properties smuggled in at runtime are ignored.
  const [l] = clientPaymentSchedule({
    lines: [line(1, { percent: 10 })],
    contractTotal: 1000,
    links: [{ lineOrder: 1, externalId: null, amount: 99999, notes: 'internal' } as never],
    invoices: [],
  });
  assert.equal(l!.amount, 100);
  assert.equal(JSON.stringify(l).includes('99999'), false);
  assert.equal(JSON.stringify(l).includes('internal'), false);
});

// ── State ────────────────────────────────────────────────────────────────────

test('a paid invoice marks its line paid', () => {
  const lines = clientPaymentSchedule({
    lines: [line(1), line(2)],
    contractTotal: null,
    links: [
      { lineOrder: 1, externalId: 'inv-paid' },
      { lineOrder: 2, externalId: 'inv-partial' },
    ],
    invoices: [
      invoice('inv-paid', { status: 'paid', amountDue: 0 }),
      invoice('inv-partial', { status: 'partially_paid', amountDue: 400 }),
    ],
  });
  assert.deepEqual(lines.map((l) => l.state), ['paid', 'due']);
});

test('lines are matched by id, never by title or amount', () => {
  // Two stages with the same name and the same figure. Only the id chain may
  // decide which one was billed — anything else puts "Paid" on the wrong stage.
  const lines = clientPaymentSchedule({
    lines: [line(1, { title: 'Progress payment', amount: 5000 }), line(2, { title: 'Progress payment', amount: 5000 })],
    contractTotal: null,
    links: [{ lineOrder: 2, externalId: 'inv-2' }],
    invoices: [invoice('inv-2', { total: 5000, status: 'paid', amountDue: 0 })],
  });
  assert.deepEqual(lines.map((l) => l.state), ['upcoming', 'paid']);
});

test('an invoice for somebody else is never matched', () => {
  // `invoices` is this homeowner's issued list. A link naming an id that is not
  // in it — another client's invoice — must not mark anything.
  const [l] = clientPaymentSchedule({
    lines: [line(1)],
    contractTotal: null,
    links: [{ lineOrder: 1, externalId: 'someone-elses-invoice' }],
    invoices: [invoice('mine')],
  });
  assert.equal(l!.state, 'upcoming');
});

// ── Shape ────────────────────────────────────────────────────────────────────

test('a line the contract does not name still gets a title', () => {
  const [l] = clientPaymentSchedule({
    lines: [line(2, { title: null })],
    contractTotal: null,
    links: [],
    invoices: [],
  });
  assert.equal(l!.title, 'Payment 2');
});

test('the homeowner line carries exactly its seven fields', () => {
  // Built by literal. The parser's `raw` line — the proposal exactly as written,
  // kept for the contractor to check the parse — is not one of them.
  const [l] = clientPaymentSchedule({ lines: [line(1)], contractTotal: null, links: [], invoices: [] });
  assert.deepEqual(Object.keys(l!).sort(), [
    'amount', 'basis', 'description', 'order', 'percent', 'state', 'title',
  ]);
});

test('lines come back in schedule order', () => {
  const lines = clientPaymentSchedule({
    lines: [line(3), line(1), line(2)],
    contractTotal: null,
    links: [],
    invoices: [],
  });
  assert.deepEqual(lines.map((l) => l.order), [1, 2, 3]);
});

// ── The summary ──────────────────────────────────────────────────────────────

test('next is the first line not yet paid', () => {
  const lines = clientPaymentSchedule({
    lines: [line(1), line(2), line(3)],
    contractTotal: null,
    links: [{ lineOrder: 1, externalId: 'p' }],
    invoices: [invoice('p', { status: 'paid', amountDue: 0 })],
  });
  assert.equal(clientScheduleSummary(lines).next?.order, 2);
});

test('an unpriced upcoming line is counted, not added as zero', () => {
  const lines = clientPaymentSchedule({
    lines: [line(1, { amount: 1000 }), line(2, { percent: 20 }), line(3)],
    contractTotal: null,
    links: [],
    invoices: [],
  });
  assert.deepEqual(clientScheduleSummary(lines), {
    next: lines[0],
    upcomingTotal: 1000,
    upcomingUnpriced: 2,
  });
});

test('a fully paid schedule has nothing next', () => {
  const lines = clientPaymentSchedule({
    lines: [line(1)],
    contractTotal: null,
    links: [{ lineOrder: 1, externalId: 'p' }],
    invoices: [invoice('p', { status: 'paid', amountDue: 0 })],
  });
  assert.equal(clientScheduleSummary(lines).next, null);
});

// ── The penny ────────────────────────────────────────────────────────────────

test('percent-computed stages close to the contract total exactly', () => {
  // $7,591.10 at 30/25/25/20, rounded stage by stage, comes to $7,591.11 — a
  // cent the contract never said. (BSA-053 shows the same cent live, but there
  // the proposal STATES those figures, so it is left alone — see below.)
  const lines = clientPaymentSchedule({
    lines: [line(1, { percent: 30 }), line(2, { percent: 25 }), line(3, { percent: 25 }), line(4, { percent: 20 })],
    contractTotal: 7591.1,
    links: [],
    invoices: [],
  });
  const cents = lines.reduce((sum, l) => sum + Math.round(l.amount! * 100), 0);
  assert.equal(cents, 759110, 'the stages must add up to the contract to the cent');
  // Earlier stages are exactly their percent; the last one absorbs the cent.
  assert.deepEqual(lines.map((l) => l.amount), [2277.33, 1897.78, 1897.78, 1518.21]);
});

test('the contractor drafts and the homeowner schedule agree on every stage', () => {
  // They share the arithmetic on purpose. Two figures for one stage is a
  // homeowner holding a schedule that disagrees with the invoice they receive.
  const content = [
    '## PAYMENT SCHEDULE',
    '- **Contract Signing & Scheduling** (30%)',
    '- **Mobilization** (25%)',
    '- **Drywall** (25%)',
    '- **Final** (20%)',
  ].join('\n');
  const contractor = draftsForProposal({ content }, 7591.1).map((d) => d.amount);
  const homeowner = clientPaymentSchedule({
    lines: parsePaymentSchedule(content),
    contractTotal: 7591.1,
    links: [],
    invoices: [],
  }).map((l) => l.amount);
  assert.deepEqual(homeowner, contractor);
});

test('a schedule whose percents do not total 100 is left alone', () => {
  // Not the whole contract — there is nothing to close to, so nothing moves.
  const lines = clientPaymentSchedule({
    lines: [line(1, { percent: 30 }), line(2, { percent: 25 })],
    contractTotal: 7591.1,
    links: [],
    invoices: [],
  });
  assert.deepEqual(lines.map((l) => l.amount), [2277.33, 1897.78]);
});

test('stated amounts are never second-guessed', () => {
  // A proposal that wrote real figures meant them — even when a figure is not
  // what its percent would give. The LAST stage here states $3,000 against a
  // 50% that would be $3,795.55; closing the contract would silently replace
  // the figure the homeowner signed. (The first version of this test used a
  // stated figure equal to its percent, and passed with the guard removed.)
  const lines = clientPaymentSchedule({
    lines: [line(1, { percent: 50 }), line(2, { percent: 50, amount: 3000 })],
    contractTotal: 7591.1,
    links: [],
    invoices: [],
  });
  assert.deepEqual(lines.map((l) => l.amount), [3795.55, 3000]);
});

test('BSA-053: a contract whose own stated stages overshoot is shown as signed', () => {
  // The live case, exactly. BuildSuite wrote these four figures into the signed
  // proposal; they sum to $7,591.11 against a $7,591.10 total. Correcting that
  // here would change a figure the homeowner signed, so it is shown as written
  // and the cent is BuildSuite's to fix at source.
  const lines = clientPaymentSchedule({
    lines: [
      line(1, { percent: 30, amount: 2277.33 }),
      line(2, { percent: 25, amount: 1897.78 }),
      line(3, { percent: 25, amount: 1897.78 }),
      line(4, { percent: 20, amount: 1518.22 }),
    ],
    contractTotal: 7591.1,
    links: [],
    invoices: [],
  });
  assert.deepEqual(lines.map((l) => l.amount), [2277.33, 1897.78, 1897.78, 1518.22]);
});
