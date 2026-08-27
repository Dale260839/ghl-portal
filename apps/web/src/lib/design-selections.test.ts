import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DESIGN_SELECTION_CONFIRMED,
  DESIGN_SELECTION_STATUSES,
  designSelectionTotals,
  selectedOption,
  selectionPriceImpact,
} from './data/types.ts';
import type { DesignOption, DesignSelection } from './data/types.ts';
import { DESIGN_SELECTIONS } from './data/portal-fixtures.ts';

const PROJECT = 'BSP-2026-000184';

function opt(over: Partial<DesignOption> = {}): DesignOption {
  return {
    id: 'opt-x',
    name: 'An option',
    detail: '',
    priceImpact: 0,
    isBaseline: false,
    imageUrl: '',
    ...over,
  };
}

function sel(over: Partial<DesignSelection> = {}): DesignSelection {
  return {
    id: 'ds-x',
    projectId: PROJECT,
    selectionNumber: '001',
    category: 'Countertops',
    title: 'A selection',
    location: 'Main Kitchen',
    description: '',
    options: [
      opt({ id: 'base', name: 'Allowance', priceImpact: 0, isBaseline: true }),
      opt({ id: 'up', name: 'Upgrade', priceImpact: 1000 }),
    ],
    selectedOptionId: null,
    status: 'Awaiting Your Selection',
    decisionDeadline: null,
    decidedBy: null,
    decidedDate: null,
    clientComments: '',
    internalNotes: '',
    clientVisible: true,
    ...over,
  };
}

test('Artifact 87 selectedOption returns the chosen option, or null when none is chosen', () => {
  assert.equal(selectedOption(sel({ selectedOptionId: 'up' }))?.id, 'up');
  assert.equal(selectedOption(sel({ selectedOptionId: null })), null);
});

test('selectedOption returns null when the id does not match any option', () => {
  // A dangling id must not throw or coerce to the first option.
  assert.equal(selectedOption(sel({ selectedOptionId: 'nope' })), null);
});

test('selectionPriceImpact is the chosen option impact, zero when nothing is chosen', () => {
  assert.equal(selectionPriceImpact(sel({ selectedOptionId: 'up' })), 1000);
  assert.equal(selectionPriceImpact(sel({ selectedOptionId: 'base' })), 0);
  assert.equal(selectionPriceImpact(sel({ selectedOptionId: null })), 0);
});

test('only Confirmed counts toward the confirmed upgrade total', () => {
  const totals = designSelectionTotals([
    sel({ status: 'Confirmed', selectedOptionId: 'up' }),
    sel({ status: 'Selection Submitted', selectedOptionId: 'up' }),
    sel({ status: 'Awaiting Your Selection', selectedOptionId: null }),
    sel({ status: 'Revision Requested', selectedOptionId: 'up' }),
  ]);
  assert.equal(totals.confirmed, 1000);
  assert.equal(totals.pending, 1000);
});

test('Awaiting and Revision Requested count as neither confirmed nor pending', () => {
  const totals = designSelectionTotals([
    sel({ status: 'Awaiting Your Selection', selectedOptionId: null }),
    sel({ status: 'Revision Requested', selectedOptionId: 'up' }),
  ]);
  assert.equal(totals.confirmed, 0);
  assert.equal(totals.pending, 0);
});

test('empty list totals to zero rather than throwing', () => {
  assert.deepEqual(designSelectionTotals([]), { confirmed: 0, pending: 0 });
});

test('DESIGN_SELECTION_CONFIRMED is a member of the status list', () => {
  // Guards the rename path: if the status is renamed, this fails rather than
  // silently making every confirmed total read zero.
  assert.ok((DESIGN_SELECTION_STATUSES as readonly string[]).includes(DESIGN_SELECTION_CONFIRMED));
});

test('§9.3 no fixture leaks internal notes through a client-facing field', () => {
  for (const s of DESIGN_SELECTIONS) {
    const clientFacing = [
      s.title,
      s.description,
      s.category,
      s.location,
      s.clientComments,
      ...s.options.flatMap((o) => [o.name, o.detail]),
    ].join(' ');
    assert.ok(
      s.internalNotes === '' || !clientFacing.includes(s.internalNotes),
      `DS-${s.selectionNumber} repeats its internal note in a client-facing field`,
    );
  }
});

test('the withheld selection is not client-visible', () => {
  // A list where everything is visible proves nothing about the §9.1 gate.
  const withheld = DESIGN_SELECTIONS.filter((s) => !s.clientVisible);
  assert.ok(withheld.length > 0, 'fixtures must include at least one withheld selection');
});

test('selection numbers are unique per project', () => {
  const seen = new Set<string>();
  for (const s of DESIGN_SELECTIONS) {
    const key = `${s.projectId}/${s.selectionNumber}`;
    assert.ok(!seen.has(key), `duplicate selection number ${key}`);
    seen.add(key);
  }
});

test('every selection offers exactly one baseline allowance option at zero impact', () => {
  for (const s of DESIGN_SELECTIONS) {
    const baselines = s.options.filter((o) => o.isBaseline);
    assert.equal(baselines.length, 1, `DS-${s.selectionNumber} must have exactly one baseline`);
    assert.equal(
      baselines[0]?.priceImpact,
      0,
      `DS-${s.selectionNumber} baseline must be included at zero impact`,
    );
  }
});

test('a set selectedOptionId always resolves to a real option', () => {
  for (const s of DESIGN_SELECTIONS.filter((x) => x.selectedOptionId !== null)) {
    assert.ok(
      selectedOption(s) !== null,
      `DS-${s.selectionNumber} points at an option that does not exist`,
    );
  }
});

test('a confirmed selection records what was chosen, by whom, and when', () => {
  for (const s of DESIGN_SELECTIONS.filter((x) => x.status === DESIGN_SELECTION_CONFIRMED)) {
    assert.ok(s.selectedOptionId !== null, `DS-${s.selectionNumber} confirmed with no choice`);
    assert.ok(s.decidedBy !== null, `DS-${s.selectionNumber} confirmed with no decider`);
    assert.ok(s.decidedDate !== null, `DS-${s.selectionNumber} confirmed with no date`);
  }
});

test('a submitted selection has a choice but is not yet confirmed', () => {
  for (const s of DESIGN_SELECTIONS.filter((x) => x.status === 'Selection Submitted')) {
    assert.ok(s.selectedOptionId !== null, `DS-${s.selectionNumber} submitted with no choice`);
    assert.equal(s.decidedBy, null, `DS-${s.selectionNumber} submitted must not record a decider`);
    assert.equal(s.decidedDate, null, `DS-${s.selectionNumber} submitted must not record a date`);
  }
});

test('an awaiting selection records no choice yet', () => {
  for (const s of DESIGN_SELECTIONS.filter((x) => x.status === 'Awaiting Your Selection')) {
    assert.equal(s.selectedOptionId, null, `DS-${s.selectionNumber} awaiting must have no choice`);
  }
});
