import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  depositDraft,
  draftInvoiceFor,
  parsePaymentSchedule,
  paymentScheduleDrafts,
  percentTotal,
  parseSectionsSchedule,
  scheduleFor,
  draftsForProposal,
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

// ── The structured source, merged in from the parallel branch (2026-09-08) ───


/** The two JSON shapes that occur in live `sections`, verbatim. */
const RICH = {
  payment_schedule: [
    {
      milestone: 'Contract Signing & Scheduling',
      percentage: 30,
      amount: 1773.75,
      trigger: 'Upon signing and scheduling',
      due_description: 'Due on signature',
    },
    { milestone: 'Rough-In Completion', percentage: 40, amount: 2365, due_description: 'At rough-in' },
  ],
};

const BASIC = {
  payment_schedule: [
    { milestone: 'Deposit', percentage: 50, amount: 1000 },
    { milestone: 'Completion', percentage: 50, amount: 1000 },
  ],
};

test('the structured source normalizes into the same ScheduleLine shape', () => {
  const lines = parseSectionsSchedule(RICH);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.order, 1);
  assert.equal(lines[0]!.title, 'Contract Signing & Scheduling');
  assert.equal(lines[0]!.percent, 30);
  assert.equal(lines[0]!.amount, 1773.75);
});

test('trigger is preferred over due_description as the invoice terms', () => {
  assert.equal(parseSectionsSchedule(RICH)[0]!.description, 'Upon signing and scheduling');
  assert.equal(parseSectionsSchedule(RICH)[1]!.description, 'At rough-in');
  assert.equal(parseSectionsSchedule(BASIC)[0]!.description, '');
});

test('schedule order is preserved — line 1 is the first invoice', () => {
  // Chris's rule: the first line is the deposit and each later line triggers
  // its own invoice, so the array order is load-bearing.
  assert.deepEqual(parseSectionsSchedule(RICH).map((l) => l.order), [1, 2]);
  assert.equal(parseSectionsSchedule(RICH)[0]!.title, 'Contract Signing & Scheduling');
});

test('sections arriving as a JSON string are parsed too', () => {
  assert.equal(parseSectionsSchedule(JSON.stringify(BASIC)).length, 2);
});

test('null, undefined, malformed JSON and non-objects are all tolerated', () => {
  for (const input of [null, undefined, 42, 'not json', '[]', {}, { payment_schedule: 'nope' }]) {
    assert.deepEqual(parseSectionsSchedule(input), [], `threw or returned on ${String(input)}`);
  }
});

test('currency-formatted string amounts are read as numbers', () => {
  const lines = parseSectionsSchedule({
    payment_schedule: [{ milestone: 'Deposit', percentage: '30', amount: '$1,773.75' }],
  });
  assert.equal(lines[0]!.amount, 1773.75);
  assert.equal(lines[0]!.percent, 30);
});

test('a line with neither figure nor name is dropped, not rendered blank', () => {
  const lines = parseSectionsSchedule({ payment_schedule: [{ note: 'TBD' }] });
  assert.deepEqual(lines, []);
});

// ── Which source wins ────────────────────────────────────────────────────────

test('structured wins over markdown when a proposal has both', () => {
  // The JSON STATES its figures; the markdown version infers them from prose.
  // Preferring the inferred one would be choosing the weaker evidence.
  const lines = scheduleFor({ sections: BASIC, content: PERCENT_ONLY });
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.title, 'Deposit', 'it fell back to the markdown parser');
  assert.equal(lines[0]!.amount, 1000);
});

test('markdown is used when there is no structured schedule', () => {
  const lines = scheduleFor({ sections: null, content: PERCENT_ONLY });
  assert.equal(lines.length, 3);
  assert.equal(lines[0]!.percent, 50);
});

test('a proposal with neither source yields nothing, not an error', () => {
  assert.deepEqual(scheduleFor({ sections: null, content: null }), []);
  assert.deepEqual(scheduleFor({}), []);
});

test('drafts from the structured source state their amounts rather than compute', () => {
  const drafts = draftsForProposal({ sections: BASIC }, null);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]!.amount, 1000);
  assert.equal(drafts[0]!.amountSource, 'stated');
  assert.equal(drafts[0]!.needsContractorInput, false, 'a complete JSON line needs nothing');
});
