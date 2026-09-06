import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePaymentSchedule,
  scheduleMatchesTotal,
} from './payment-schedule.ts';

/**
 * Fixtures are REAL rows, copied verbatim from proposals.sections.payment_schedule
 * in the live database on 2026-09-05. Testing against invented shapes would only
 * prove the parser matches my guess; these prove it matches production.
 */

// proposal 5029dcd8 — the basic shape, no terms text.
const BASIC = {
  payment_schedule: [
    { amount: 1200, milestone: 'Contract Signing', percentage: 10 },
    { amount: 2400, milestone: 'Completion of Site Preparation', percentage: 20 },
    { amount: 4800, milestone: 'Completion of Concrete Pouring', percentage: 40 },
    { amount: 3600, milestone: 'Final Inspection and Approval', percentage: 30 },
  ],
};

// proposal 65006190 — the rich shape, with trigger + due_description.
const RICH = {
  payment_schedule: [
    {
      amount: 1773.75,
      trigger: 'Due upon signed contract — secures your spot on the schedule and covers material procurement',
      milestone: 'Contract Signing & Scheduling',
      percentage: 30,
      due_description: 'Due at contract signing',
    },
    {
      amount: 1773.75,
      trigger: 'Due when site preparation is complete and door installation begins',
      milestone: 'Start of Door Installation',
      percentage: 30,
      due_description: 'Due at start of door installation',
    },
    {
      amount: 1182.5,
      milestone: 'Midpoint Completion',
      percentage: 20,
      due_description: 'Due at midpoint',
    },
    {
      amount: 1182.5,
      milestone: 'Project Completion',
      percentage: 20,
      due_description: 'Due at completion',
    },
  ],
};

test('the first line is the first invoice, and keeps its schedule order', () => {
  const s = parsePaymentSchedule(BASIC);
  assert.equal(s.lines.length, 4);
  assert.equal(s.first?.position, 1);
  assert.equal(s.first?.milestone, 'Contract Signing');
  assert.equal(s.first?.amount, 1200);
  assert.equal(s.first?.percentage, 10);
  // Order preserved, not sorted by amount or percentage.
  assert.deepEqual(
    s.lines.map((l) => l.milestone),
    ['Contract Signing', 'Completion of Site Preparation', 'Completion of Concrete Pouring', 'Final Inspection and Approval'],
  );
});

test('the rich shape carries the trigger as the invoice terms', () => {
  const s = parsePaymentSchedule(RICH);
  assert.equal(s.first?.milestone, 'Contract Signing & Scheduling');
  assert.equal(s.first?.amount, 1773.75);
  assert.match(s.first?.terms ?? '', /Due upon signed contract/);
});

test('terms fall back to due_description when there is no trigger', () => {
  const s = parsePaymentSchedule(RICH);
  const midpoint = s.lines[2]!;
  assert.equal(midpoint.milestone, 'Midpoint Completion');
  assert.equal(midpoint.terms, 'Due at midpoint');
});

test('the basic shape simply has no terms, and that is fine', () => {
  const s = parsePaymentSchedule(BASIC);
  assert.equal(s.first?.terms, '');
});

test('line amounts total to the contract, matching the proposal total', () => {
  const basic = parsePaymentSchedule(BASIC);
  assert.equal(basic.amountTotal, 12000); // proposal 5029dcd8 total was 12000
  assert.equal(scheduleMatchesTotal(basic, 12000), true);

  const rich = parsePaymentSchedule(RICH);
  assert.equal(rich.amountTotal, 5912.5); // proposal 65006190 total was 5912.5
  assert.equal(scheduleMatchesTotal(rich, 5912.5), true);
});

test('a total mismatch is surfaced, not swallowed', () => {
  assert.equal(scheduleMatchesTotal(parsePaymentSchedule(BASIC), 9999), false);
});

test('a missing total is unknowable, not a mismatch', () => {
  assert.equal(scheduleMatchesTotal(parsePaymentSchedule(BASIC), null), null);
  assert.equal(scheduleMatchesTotal(parsePaymentSchedule({ payment_schedule: [] }), 100), null);
});

test('a proposal with no schedule yields an empty schedule, not an error', () => {
  const s = parsePaymentSchedule({ other_section: {} });
  assert.equal(s.lines.length, 0);
  assert.equal(s.first, null);
  assert.equal(s.amountTotal, 0);
});

test('sections that arrive as a JSON string are parsed too', () => {
  const s = parsePaymentSchedule(JSON.stringify(BASIC));
  assert.equal(s.first?.milestone, 'Contract Signing');
});

test('null, undefined, and non-objects are tolerated', () => {
  for (const bad of [null, undefined, 42, '', 'not json', []]) {
    const s = parsePaymentSchedule(bad);
    assert.equal(s.lines.length, 0);
    assert.equal(s.first, null);
  }
});

test('a line with no milestone is dropped, not rendered blank', () => {
  const s = parsePaymentSchedule({
    payment_schedule: [
      { amount: 100, percentage: 10 }, // no milestone — dropped
      { amount: 900, milestone: 'Real one', percentage: 90 },
    ],
  });
  assert.equal(s.lines.length, 1);
  assert.equal(s.first?.milestone, 'Real one');
  // Position is renumbered after the drop, so line 1 is genuinely the first.
  assert.equal(s.first?.position, 1);
});

test('string amounts with currency formatting are read as numbers', () => {
  const s = parsePaymentSchedule({
    payment_schedule: [{ amount: '$1,773.75', milestone: 'Deposit', percentage: '30' }],
  });
  assert.equal(s.first?.amount, 1773.75);
  assert.equal(s.first?.percentage, 30);
});
