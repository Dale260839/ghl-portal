import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  depositDraft,
  draftInvoiceFor,
  parsePaymentSchedule,
  paymentScheduleDrafts,
  percentTotal,
} from './payment-schedule.ts';

/**
 * The fixtures below are copied VERBATIM from live proposals, not invented.
 * Measured across all 46 rows on 2026-09-03: 33 have a schedule section, and
 * only 4 of those state any dollar amount.
 */

const PERCENT_ONLY = `
## PAYMENT SCHEDULE

Owner agrees to pay Contractor as follows:

- **50%** upon acceptance of this contract and project scheduling
- **25%** upon start of construction
- **25%** upon completion of punch list

All payments are due upon invoice receipt unless otherwise stated.

---

## SCOPE OF WORK
`;

const TITLED_WITH_MONEY = `
## PAYMENT SCHEDULE

- **Contract Signing & Scheduling** (30% — $1,773.75)
- **Start of Door Installation** (30% — $1,773.75)
- **Rough-In Completion** (30% — $1,221.00)
- **Fixture Installation** (20% — $814.00)

---
`;

const TITLE_NO_MONEY = `
## PAYMENT SCHEDULE

- Contract Signing (10%)
- Completion (90%)

---
`;

// ── Parsing the three shapes that actually occur ─────────────────────────────

test('the percent-only shape yields a percent and prose, and no invented title', () => {
  const lines = parsePaymentSchedule(PERCENT_ONLY);
  assert.equal(lines.length, 3);

  assert.equal(lines[0]!.percent, 50);
  assert.equal(lines[0]!.amount, null);
  assert.equal(
    lines[0]!.title,
    null,
    'the bolded run here is "50%" — treating it as a title puts a percent in the invoice title',
  );
  assert.equal(lines[0]!.description, 'upon acceptance of this contract and project scheduling');
  assert.equal(lines[0]!.order, 1);
});

test('the titled shape with money yields all four fields', () => {
  const lines = parsePaymentSchedule(TITLED_WITH_MONEY);
  assert.equal(lines.length, 4);

  assert.equal(lines[0]!.title, 'Contract Signing & Scheduling');
  assert.equal(lines[0]!.percent, 30);
  assert.equal(lines[0]!.amount, 1773.75);
});

test('a title before a parenthesised percent is read as a title', () => {
  const lines = parsePaymentSchedule(TITLE_NO_MONEY);
  assert.equal(lines[0]!.title, 'Contract Signing');
  assert.equal(lines[0]!.percent, 10);
  assert.equal(lines[0]!.amount, null);
});

test('prose in the section is not mistaken for an instalment', () => {
  // "All payments are due upon invoice receipt" is a term, not a line item —
  // and it is not a list item either, so it must not appear.
  const lines = parsePaymentSchedule(PERCENT_ONLY);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(line.percent !== null || line.amount !== null);
  }
});

test('parsing never throws on the states that are common in live data', () => {
  assert.deepEqual(parsePaymentSchedule(null), []);
  assert.deepEqual(parsePaymentSchedule(undefined), []);
  assert.deepEqual(parsePaymentSchedule(''), []);
  assert.deepEqual(parsePaymentSchedule('# Proposal\n\nNo schedule here.'), []);
  assert.deepEqual(parsePaymentSchedule('## PAYMENT SCHEDULE\n\nTo be agreed.\n\n---'), []);
});

test('the section stops at the next heading', () => {
  // Otherwise the scope of work gets parsed as instalments.
  const lines = parsePaymentSchedule(PERCENT_ONLY);
  assert.equal(lines.length, 3, 'it ran past the --- into SCOPE OF WORK');
});

// ── Turning a line into a draft ──────────────────────────────────────────────

test('a stated amount is used as stated, never recomputed', () => {
  const [line] = parsePaymentSchedule(TITLED_WITH_MONEY);
  const draft = draftInvoiceFor(line!, 100000);

  assert.equal(draft.amount, 1773.75, 'the proposal says so; a percent of a total must not override it');
  assert.equal(draft.amountSource, 'stated');
  assert.equal(draft.needsContractorInput, false);
});

test('a percent becomes an amount only when there is a total to apply it to', () => {
  const [line] = parsePaymentSchedule(PERCENT_ONLY);
  const draft = draftInvoiceFor(line!, 25000);

  assert.equal(draft.amount, 12500);
  assert.equal(draft.amountSource, 'computed');
});

test('§ money is never invented — no total means no amount, not zero', () => {
  // The failure that matters. `proposals.total` is null on all four SIGNED
  // proposals, so this is the live path, not an edge case. A zero here is a
  // figure a contractor could send to a homeowner.
  const [line] = parsePaymentSchedule(PERCENT_ONLY);
  const draft = draftInvoiceFor(line!, null);

  assert.equal(draft.amount, null);
  assert.notEqual(draft.amount, 0);
  assert.equal(draft.amountSource, 'unavailable');
  assert.equal(draft.needsContractorInput, true);
  assert.match(draft.warnings.join(' '), /no contract total/i);
});

test('a zero or negative contract total does not produce a zero invoice', () => {
  const [line] = parsePaymentSchedule(PERCENT_ONLY);
  for (const total of [0, -1]) {
    const draft = draftInvoiceFor(line!, total);
    assert.equal(draft.amount, null, `total ${total} produced an amount`);
    assert.equal(draft.amountSource, 'unavailable');
  }
});

test('a missing title is flagged rather than filled in', () => {
  const [line] = parsePaymentSchedule(PERCENT_ONLY);
  const draft = draftInvoiceFor(line!, 25000);

  assert.equal(draft.line.title, null);
  assert.equal(draft.needsContractorInput, true);
  assert.match(draft.warnings.join(' '), /does not name this milestone/i);
});

test('computed amounts are rounded to cents', () => {
  const [line] = parsePaymentSchedule(TITLE_NO_MONEY);
  const draft = draftInvoiceFor(line!, 3333.33);
  assert.equal(draft.amount, 333.33);
});

// ── The deposit, and the timeline it belongs to ──────────────────────────────

test('the deposit is the first schedule line', () => {
  const draft = depositDraft(TITLED_WITH_MONEY, null);
  assert.equal(draft?.line.title, 'Contract Signing & Scheduling');
  assert.equal(draft?.line.order, 1);
});

test('every line becomes a draft, not only the first', () => {
  // The handoff is explicit: do not hardcode "first line only" — each later
  // line triggers its own invoice at its milestone.
  const drafts = paymentScheduleDrafts(TITLED_WITH_MONEY, null);
  assert.equal(drafts.length, 4);
  assert.deepEqual(drafts.map((d) => d.line.order), [1, 2, 3, 4]);
  assert.deepEqual(
    drafts.map((d) => d.amount),
    [1773.75, 1773.75, 1221, 814],
  );
});

test('an empty schedule yields no deposit rather than an empty invoice', () => {
  assert.equal(depositDraft(null, 25000), null);
  assert.equal(depositDraft('## PAYMENT SCHEDULE\n\nTBD\n\n---', 25000), null);
});

test('percentTotal reports the sum without enforcing it', () => {
  assert.equal(percentTotal(parsePaymentSchedule(PERCENT_ONLY)), 100);
  assert.equal(percentTotal(parsePaymentSchedule(TITLED_WITH_MONEY)), 110);
  assert.equal(percentTotal([]), null);
});
