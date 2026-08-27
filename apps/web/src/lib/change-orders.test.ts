import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHANGE_ORDER_APPROVED,
  CHANGE_ORDER_STATUSES,
  changeOrderNet,
  changeOrderTotals,
} from './data/types.ts';
import type { ChangeOrder } from './data/types.ts';
import { CHANGE_ORDERS } from './data/portal-fixtures.ts';
import { PROJECTS } from './data/fixtures.ts';

const PROJECT = 'BSP-2026-000184';

function co(over: Partial<ChangeOrder> = {}): ChangeOrder {
  return {
    id: 'co-x',
    projectId: PROJECT,
    changeOrderNumber: '001',
    title: 'A change',
    description: '',
    reason: '',
    requestedBy: 'Marcus Reyes',
    createdDate: '2026-08-01',
    addedCost: 0,
    creditAmount: 0,
    scheduleImpactDays: 0,
    revisedCompletionDate: null,
    approvalDeadline: null,
    status: 'Client Review Pending',
    clientComments: '',
    approvedBy: null,
    approvalDate: null,
    internalNotes: '',
    clientVisible: true,
    ...over,
  };
}

test('§6.6 net is added cost less credit', () => {
  assert.equal(changeOrderNet(co({ addedCost: 2150, creditAmount: 400 })), 1750);
  assert.equal(changeOrderNet(co({ addedCost: 0, creditAmount: 0 })), 0);
});

test('§6.6 a credit-only change order reduces the contract', () => {
  assert.equal(changeOrderNet(co({ addedCost: 0, creditAmount: 600 })), -600);
});

test('only Approved counts toward the approved total', () => {
  const totals = changeOrderTotals([
    co({ status: 'Approved', addedCost: 1450 }),
    co({ status: 'Client Review Pending', addedCost: 1850 }),
    co({ status: 'Revision Requested', addedCost: 900 }),
    co({ status: 'Rejected', addedCost: 5000 }),
  ]);
  assert.equal(totals.approved, 1450);
  assert.equal(totals.pending, 1850);
});

test('the net total never includes pending money', () => {
  // A client who reads a pending figure as agreed will dispute the invoice.
  const totals = changeOrderTotals([
    co({ status: 'Approved', addedCost: 1000 }),
    co({ status: 'Client Review Pending', addedCost: 9999 }),
  ]);
  assert.equal(totals.net, totals.approved);
  assert.equal(totals.net, 1000);
});

test('Revision Requested and Rejected are counted as neither approved nor pending', () => {
  const totals = changeOrderTotals([
    co({ status: 'Revision Requested', addedCost: 400 }),
    co({ status: 'Rejected', addedCost: 700 }),
  ]);
  assert.equal(totals.approved, 0);
  assert.equal(totals.pending, 0);
});

test('empty list totals to zero rather than throwing', () => {
  const totals = changeOrderTotals([]);
  assert.deepEqual(totals, { approved: 0, pending: 0, net: 0 });
});

test('CHANGE_ORDER_APPROVED is a member of the status list', () => {
  // Guards the rename path: if Chris's approval workflow renames the status,
  // this fails rather than silently making every total read zero.
  assert.ok((CHANGE_ORDER_STATUSES as readonly string[]).includes(CHANGE_ORDER_APPROVED));
});

test('§9.3 no fixture leaks internal notes through a client-visible field', () => {
  for (const order of CHANGE_ORDERS) {
    const clientFacing = [order.title, order.description, order.reason, order.clientComments].join(
      ' ',
    );
    assert.ok(
      !clientFacing.includes(order.internalNotes) || order.internalNotes === '',
      `CO-${order.changeOrderNumber} repeats its internal note in a client-facing field`,
    );
  }
});

test('the withheld change order is not client-visible', () => {
  // A list where everything is visible proves nothing about the gate.
  const withheld = CHANGE_ORDERS.filter((c) => !c.clientVisible);
  assert.ok(withheld.length > 0, 'fixtures must include at least one withheld change order');
});

test('fixture totals reconcile with the project financials', () => {
  // The PM sees `approvedChangeOrders` and `pendingChangeOrders` on the project.
  // A client seeing a different number is worse than showing none at all.
  const project = PROJECTS.find((p) => p.buildsuiteProjectId === PROJECT);
  assert.ok(project !== undefined, 'fixture project must exist');

  const visible = CHANGE_ORDERS.filter((c) => c.projectId === PROJECT && c.clientVisible);
  const totals = changeOrderTotals(visible);

  assert.equal(
    totals.approved,
    project.approvedChangeOrders,
    'approved change orders must match the project financials',
  );
  assert.equal(
    totals.pending,
    project.pendingChangeOrders,
    'pending change orders must match the project financials',
  );
});

test('change order numbers are unique per project', () => {
  const seen = new Set<string>();
  for (const order of CHANGE_ORDERS) {
    const key = `${order.projectId}/${order.changeOrderNumber}`;
    assert.ok(!seen.has(key), `duplicate change order number ${key}`);
    seen.add(key);
  }
});

test('an approved change order records who approved it and when', () => {
  for (const order of CHANGE_ORDERS.filter((c) => c.status === CHANGE_ORDER_APPROVED)) {
    assert.ok(order.approvedBy !== null, `CO-${order.changeOrderNumber} approved with no approver`);
    assert.ok(order.approvalDate !== null, `CO-${order.changeOrderNumber} approved with no date`);
  }
});

test('a pending change order records neither approver nor approval date', () => {
  for (const order of CHANGE_ORDERS.filter((c) => c.status === 'Client Review Pending')) {
    assert.equal(order.approvedBy, null);
    assert.equal(order.approvalDate, null);
  }
});
