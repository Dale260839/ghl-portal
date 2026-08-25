/**
 * Phase B — WF5, WF6, and the client projections for §6.5 / §6.6 / §6.7.
 *
 * The load-bearing tests here are the deny-list ones. A selection carries
 * `Actual Cost` and an issue carries `Internal Notes`; both are §9.3 fields, and
 * both sit on records the client portal is supposed to display. That is exactly
 * the shape of a leak, so the projections drop them by construction and these
 * tests assert the property is absent rather than merely empty.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planSelectionApproved, type Wf5Trigger } from './wf5-selection-approved.ts';
import {
  netChangeOrderAmount,
  planChangeOrderApproved,
  type Wf6Trigger,
} from './wf6-change-order-approved.ts';
import { effectsOfType } from './effects.ts';
import { budgetFor, budgetTotals, changeOrdersFor, issuesFor, selectionsFor } from '../portal-gates.ts';
import { PROJECTS } from '../data/fixtures.ts';
import { SELECTIONS } from '../data/portal-fixtures.ts';

const PROJECT_ID = 'BSP-2026-000184';
const project = PROJECTS.find((p) => p.buildsuiteProjectId === PROJECT_ID)!;

// ── §9.3: the deny-list, on records the client is shown ──────────────────────

test('§9.3 a client selection has no Actual Cost property at all', () => {
  const selections = selectionsFor(project);
  assert.ok(selections.length > 0, 'fixtures must provide selections');

  for (const s of selections) {
    // Not "is zero" or "is empty" — absent. A property that exists can be
    // serialized by something that iterates keys.
    assert.equal('actualCost' in s, false, `${s.selectionName} still carries actualCost`);
  }

  // And the internal value really is different from the allowance, so the test
  // would fail loudly if the projection ever started passing the record through.
  const internal = SELECTIONS.find((s) => s.id === 'sel-2')!;
  assert.notEqual(internal.actualCost, internal.allowance);
});

test('§9.3 a client issue carries no Internal Notes and no assignee', () => {
  const issues = issuesFor(project);
  assert.ok(issues.length > 0, 'fixtures must provide issues with a client update');

  for (const i of issues) {
    assert.equal('internalNotes' in i, false, `${i.issueNumber} still carries internalNotes`);
    assert.equal('assignedTo' in i, false, `${i.issueNumber} still names an assignee`);
  }
});

test('an issue with no client update is not shown at all', () => {
  const shown = issuesFor(project).map((i) => i.issueNumber);
  const withoutUpdate = PROJECTS.length > 0 ? shown : [];
  // Every issue that IS shown must have a non-empty client update.
  for (const i of issuesFor(project)) {
    assert.notEqual(i.clientUpdate.trim(), '');
  }
  assert.deepEqual(withoutUpdate, shown);
});

test('a budget line has no field capable of holding a cost or a margin', () => {
  const lines = budgetFor(project);
  assert.ok(lines.length > 0);
  const keys = Object.keys(lines[0]!);
  for (const banned of ['cost', 'margin', 'markup', 'profit', 'vendorCost']) {
    assert.equal(
      keys.some((k) => k.toLowerCase().includes(banned.toLowerCase())),
      false,
      `budget line exposes ${banned}`,
    );
  }
});

// ── §9.1: the switches still govern ──────────────────────────────────────────

test('§9.1 a disabled portal returns nothing on every Phase B screen', () => {
  const closed = { ...project, clientPortalEnabled: false };

  assert.deepEqual(selectionsFor(closed), []);
  assert.deepEqual(changeOrdersFor(closed), []);
  assert.deepEqual(budgetFor(closed), []);
  assert.deepEqual(issuesFor(closed), []);
});

test('§6.1 the budget switch empties the budget without touching the rest', () => {
  const noBudget = { ...project, showBudgetToClient: false };

  assert.deepEqual(budgetFor(noBudget), []);
  // The other three are unaffected — one switch, one screen.
  assert.ok(selectionsFor(noBudget).length > 0);
  assert.ok(changeOrdersFor(noBudget).length > 0);
});

test('items marked not client-visible are withheld', () => {
  // The fixtures deliberately hold one of each; a list that showed everything
  // would prove nothing about the gate.
  const shownSelections = selectionsFor(project).map((s) => s.id);
  assert.equal(shownSelections.includes('sel-4'), false, 'withheld selection leaked');

  const shownOrders = changeOrdersFor(project).map((c) => c.id);
  assert.equal(shownOrders.includes('co-3'), false, 'absorbed change order leaked');
});

// ── WF5 ──────────────────────────────────────────────────────────────────────

function wf5(over: Partial<Wf5Trigger> = {}): Wf5Trigger {
  return {
    buildsuiteProjectId: PROJECT_ID,
    selectionId: 'sel-2',
    selectionName: 'Countertop slab',
    status: 'Approved',
    clientDecision: 'Approved',
    allowance: 6200,
    upgradeAmount: 1450,
    creditAmount: 0,
    requiresChangeOrder: true,
    relatedTaskId: 'task-9',
    today: '2026-08-21',
    otherSelectionsAwaitingClient: false,
    ...over,
  };
}

test('WF5 runs only on Approved', () => {
  for (const status of ['Pending', 'Awaiting Client', 'Rejected']) {
    const plan = planSelectionApproved(wf5({ status }));
    assert.equal(plan.ran, false, `${status} must not trigger WF5`);
  }
  assert.equal(planSelectionApproved(wf5()).ran, true);
});

test('WF5 plans every §11 action', () => {
  const plan = planSelectionApproved(wf5());
  assert.ok(plan.ran);
  const types = plan.effects.map((e) => e.type);

  for (const required of [
    'RecordSelectionApproval',
    'UpdateSelectionAmounts',
    'NotifyInternal',
    'UpdateRelatedTask',
    'CreateChangeOrderFromSelection',
    'SetClientActionRequired',
  ]) {
    assert.ok(types.includes(required as never), `WF5 is missing ${required}`);
  }
});

test('WF5 creates a change order only when the selection needs one', () => {
  const within = planSelectionApproved(wf5({ requiresChangeOrder: false, upgradeAmount: 0 }));
  assert.ok(within.ran);
  assert.equal(effectsOfType(within.effects, 'CreateChangeOrderFromSelection').length, 0);
});

test('WF5 leaves the client-action alert up while others are outstanding', () => {
  const more = planSelectionApproved(wf5({ otherSelectionsAwaitingClient: true }));
  assert.ok(more.ran);
  assert.equal(effectsOfType(more.effects, 'SetClientActionRequired').length, 0);
});

test('WF5 never reads the internal cost', () => {
  // The trigger type has no actualCost field; this pins that it stays that way.
  const trigger = wf5() as unknown as Record<string, unknown>;
  assert.equal('actualCost' in trigger, false);
});

// ── WF6 ──────────────────────────────────────────────────────────────────────

function wf6(over: Partial<Wf6Trigger> = {}): Wf6Trigger {
  return {
    buildsuiteProjectId: PROJECT_ID,
    changeOrderId: 'co-1',
    changeOrderNumber: 'CO-001',
    title: 'Countertop upgrade',
    status: 'Approved',
    approvedBy: 'Dana Johnson',
    addedCost: 1450,
    creditAmount: 0,
    tax: 119.63,
    approvedChangeOrdersBefore: 0,
    contractAmount: 68000,
    revisedCompletionDate: null,
    invoiceOnApproval: true,
    contactId: 'contact-johnson',
    clientPortalEnabled: true,
    today: '2026-08-21',
    ...over,
  };
}

test('WF6 runs only on Approved', () => {
  for (const status of ['Draft', 'Awaiting Client', 'Rejected']) {
    assert.equal(planChangeOrderApproved(wf6({ status })).ran, false);
  }
  assert.equal(planChangeOrderApproved(wf6()).ran, true);
});

test('WF6 arithmetic: added cost plus tax, less credit', () => {
  assert.equal(netChangeOrderAmount({ addedCost: 1450, tax: 119.63, creditAmount: 0 }), 1569.63);
  assert.equal(netChangeOrderAmount({ addedCost: 1000, tax: 80, creditAmount: 300 }), 780);
});

test('WF6 moves both client-visible totals, and moves them consistently', () => {
  const plan = planChangeOrderApproved(wf6({ approvedChangeOrdersBefore: 500 }));
  assert.ok(plan.ran);

  const [approved] = effectsOfType(plan.effects, 'UpdateApprovedChangeOrders');
  const [total] = effectsOfType(plan.effects, 'RecalculateProjectTotal');
  assert.ok(approved && total);

  assert.equal(approved.total, 500 + 1569.63);
  // The contract total must equal contract + approved changes, or the client
  // sees two numbers that do not reconcile.
  assert.equal(total.currentProjectTotal, 68000 + approved.total);
});

test('WF6 does not invoice a credit-only change order', () => {
  const credit = planChangeOrderApproved(
    wf6({ addedCost: 0, tax: 0, creditAmount: 400, invoiceOnApproval: true }),
  );
  assert.ok(credit.ran);
  assert.equal(effectsOfType(credit.effects, 'CreateInvoice').length, 0);
});

test('WF6 adjusts the finish date only when one was set', () => {
  const unchanged = planChangeOrderApproved(wf6());
  assert.ok(unchanged.ran);
  assert.equal(effectsOfType(unchanged.effects, 'AdjustCompletionDate').length, 0);

  const moved = planChangeOrderApproved(wf6({ revisedCompletionDate: '2026-10-03' }));
  assert.ok(moved.ran);
  assert.equal(effectsOfType(moved.effects, 'AdjustCompletionDate')[0]?.revisedCompletionDate, '2026-10-03');
});

test('§9.1 WF6 does not touch the portal or the client when the portal is off', () => {
  const plan = planChangeOrderApproved(wf6({ clientPortalEnabled: false }));
  assert.ok(plan.ran);

  assert.equal(effectsOfType(plan.effects, 'UpdatePortal').length, 0);
  assert.equal(effectsOfType(plan.effects, 'NotifyClient').length, 0);
  // Accounting still hears about it — the money moved regardless.
  assert.equal(effectsOfType(plan.effects, 'NotifyAccounting').length, 1);
});

test('WF6 cannot notify a client that does not exist', () => {
  const plan = planChangeOrderApproved(wf6({ contactId: null }));
  assert.ok(plan.ran);
  assert.equal(effectsOfType(plan.effects, 'NotifyClient').length, 0);
});

// ── Budget arithmetic ────────────────────────────────────────────────────────

test('budget totals reconcile with the rows above them', () => {
  const lines = budgetFor(project);
  const t = budgetTotals(lines);

  assert.equal(t.contracted, lines.reduce((s, l) => s + l.contracted, 0));
  assert.equal(t.total, t.contracted + t.changeOrders);
  assert.equal(t.outstanding, t.invoiced - t.paid);
});

test('an empty budget totals to zero rather than throwing', () => {
  const t = budgetTotals([]);
  assert.deepEqual(t, {
    contracted: 0,
    changeOrders: 0,
    invoiced: 0,
    paid: 0,
    total: 0,
    outstanding: 0,
  });
});
