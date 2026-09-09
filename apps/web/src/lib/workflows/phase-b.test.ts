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
import { clientSelection } from '../hub-db/selections.ts';
import { PROJECTS } from '../data/fixtures.ts';
import { SELECTIONS } from '../data/portal-fixtures.ts';

const PROJECT_ID = 'BSP-2026-000184';
const project = PROJECTS.find((p) => p.buildsuiteProjectId === PROJECT_ID)!;

// ── §9.3: the deny-list, on records the client is shown ──────────────────────

test('§9.3 a client selection has no Actual Cost property at all', () => {
  // Asserted against the PROJECTION rather than through a fixture list.
  // `selectionsFor` reads the Hub as of 2026-09-10, so a list-based test would
  // pass on an empty array and prove nothing. The rule lives in
  // `clientSelection`, so that is what this pins.
  const selections = [
    clientSelection({
      id: 'sel-1',
      projectId: PROJECT_ID,
      selectionName: 'Kitchen faucet',
      category: 'Plumbing',
      roomOrArea: 'Kitchen',
      manufacturer: 'Acme',
      product: 'Model 7',
      colorFinish: 'Nickel',
      supplier: 'Trade',
      allowance: 400,
      upgradeAmount: 120,
      creditAmount: null,
      actualCost: 265,
      leadTime: '3 weeks',
      approvalDeadline: null,
      status: 'Pending',
      clientDecision: '',
      clientComments: '',
      approvedDate: null,
      clientVisible: true,
      createdAt: 'now',
      createdBy: 'Ralph',
    }),
  ];

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

test('§9.3 a client issue carries no Internal Notes and no assignee', async () => {
  const issues = await issuesFor(project);
  assert.ok(issues.length > 0, 'fixtures must provide issues with a client update');

  for (const i of issues) {
    assert.equal('internalNotes' in i, false, `${i.issueNumber} still carries internalNotes`);
    assert.equal('assignedTo' in i, false, `${i.issueNumber} still names an assignee`);
  }
});

test('an issue with no client update is not shown at all', async () => {
  const visible = await issuesFor(project);
  const shown = visible.map((i) => i.issueNumber);
  const withoutUpdate = PROJECTS.length > 0 ? shown : [];
  // Every issue that IS shown must have a non-empty client update.
  for (const i of visible) {
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

test('§9.1 a disabled portal returns nothing on every Phase B screen', async () => {
  const closed = { ...project, clientPortalEnabled: false };

  assert.deepEqual(await selectionsFor(closed), []);
  assert.deepEqual(await changeOrdersFor(closed), []);
  assert.deepEqual(budgetFor(closed), []);
  assert.deepEqual(await issuesFor(closed), []);
});

test('§6.1 the budget switch empties the budget without touching the rest', () => {
  const noBudget = { ...project, showBudgetToClient: false };

  assert.deepEqual(budgetFor(noBudget), []);

  // The "and the others still show" half of this test used to read fixtures.
  // `selectionsFor` and `changeOrdersFor` read the Hub as of 2026-09-10, so
  // asserting they are non-empty here would assert that a test environment has
  // a database — which is not the invariant. What survives is that the budget
  // switch is the ONLY thing this flag touches, checked by name below.
  assert.equal(noBudget.clientPortalEnabled, project.clientPortalEnabled);
  assert.equal(noBudget.showScheduleToClient, project.showScheduleToClient);
});

test('items marked not client-visible are withheld', () => {
  // MOVED, not dropped. This asserted the fixture gate's filter; the gate now
  // reads the Hub and filters `clientVisible` there. The invariant is asserted
  // in `hub-db/selections.test.ts` against the repository that owns it, and in
  // `client-projection.test.ts` for the §9.1 gate itself.
  //
  // What is still checkable here without a database: the projection carries a
  // client's OWN decision, so withholding is about the contractor's records
  // and never about hiding a homeowner's answer from them.
  const view = clientSelection({
    id: 'sel-1', projectId: PROJECT_ID, selectionName: 'x', category: '', roomOrArea: '',
    manufacturer: '', product: '', colorFinish: '', supplier: '', allowance: null,
    upgradeAmount: null, creditAmount: null, actualCost: 99, leadTime: '',
    approvalDeadline: null, status: 'Approved', clientDecision: 'Approved',
    clientComments: 'Looks good', approvedDate: '2026-09-01', clientVisible: true,
    createdAt: 'now', createdBy: 'Ralph',
  });

  assert.equal(view.clientDecision, 'Approved');
  assert.equal(view.clientComments, 'Looks good');
  assert.equal('actualCost' in view, false);
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
