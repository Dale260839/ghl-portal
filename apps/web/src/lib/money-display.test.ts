import { test } from 'node:test';
import assert from 'node:assert/strict';

import { moneyDisplay } from './data/types.ts';
import type { Project } from './data/types.ts';

const currency = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

/** A live BuildSuite row: a band, and no contract total of its own. */
function liveProject(over: Partial<Project> = {}): Project {
  return {
    provenance: 'buildsuite',
    budgetBand: '$10,000 - $50,000',
    currentProjectTotal: 0,
    ...over,
  } as unknown as Project;
}

test('a SIGNED proposal figure is the contract, and outranks the band', () => {
  // The defect this fixes: a job whose signed proposal said $24,500 displayed
  // "$10,000 - $50,000", because the label could not see the proposal.
  const money = moneyDisplay(liveProject(), currency, { amount: 24500, signed: true });

  assert.equal(money.label, '$24,500.00');
  assert.equal(money.basis, 'contract');
});

test('an UNSIGNED figure is shown but marked, never passed off as a contract', () => {
  // It is a real number nobody agreed to. Sitting unmarked in a column headed
  // Contract, it reads as a price somebody committed to — and the invoices are
  // built from the signed figure, so the two must not look alike.
  const money = moneyDisplay(liveProject(), currency, { amount: 99383.75, signed: false });

  assert.equal(money.label, '$99,383.75');
  assert.equal(money.basis, 'quoted', 'an unsigned quote was presented as a contract');
});

test('§ a band is never presented as a figure', () => {
  const money = moneyDisplay(liveProject(), currency, { amount: null, signed: false });

  assert.equal(money.label, '$10,000 - $50,000');
  assert.equal(money.basis, 'range');
});

test('no proposal at all still falls back to the band', () => {
  assert.equal(moneyDisplay(liveProject(), currency, null).basis, 'range');
  assert.equal(moneyDisplay(liveProject(), currency).basis, 'range');
});

test('neither a figure nor a band yields a dash, not a zero', () => {
  // A live row has currentProjectTotal: 0. Rendering that as "$0.00" is a
  // confident claim that the job is worth nothing.
  const money = moneyDisplay(liveProject({ budgetBand: undefined }), currency, null);

  assert.equal(money.label, '—');
  assert.equal(money.basis, 'none');
  assert.notEqual(money.label, '$0.00');
});

test('a blank band counts as no band', () => {
  assert.equal(moneyDisplay(liveProject({ budgetBand: '   ' }), currency, null).basis, 'none');
});

test('a record carrying its own total still uses it when there is no proposal', () => {
  // Fixture and GHL records do have a real total; only live BuildSuite rows
  // carry zero.
  const own = liveProject({ provenance: 'fixture', currentProjectTotal: 8000 });
  const money = moneyDisplay(own, currency, null);

  assert.equal(money.label, '$8,000.00');
  assert.equal(money.basis, 'contract');
});

test('the proposal figure beats a record’s own total', () => {
  // If they disagree, the proposal is the document that was signed.
  const own = liveProject({ provenance: 'fixture', currentProjectTotal: 8000 });
  const money = moneyDisplay(own, currency, { amount: 24500, signed: true });

  assert.equal(money.label, '$24,500.00');
});
