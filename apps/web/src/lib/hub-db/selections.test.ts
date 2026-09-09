import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubSelections, clientSelection, type SelectionRecord } from './selections.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';
import { findInternalFields } from '@buildsuite/contracts';

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

function recording() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async insert(args: Record<string, unknown>) {
      calls.push({ op: 'insert', args });
      return [];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { calls, repo: new HubSelections(client as never) };
}

function selection(over: Partial<SelectionRecord> = {}): SelectionRecord {
  return {
    id: 's1',
    projectId: 'p1',
    selectionName: 'Kitchen faucet',
    category: 'Plumbing',
    roomOrArea: 'Kitchen',
    manufacturer: 'Acme',
    product: 'Model 7',
    colorFinish: 'Brushed nickel',
    supplier: 'Trade Supply',
    allowance: 400,
    upgradeAmount: 120,
    creditAmount: null,
    actualCost: 265,
    leadTime: '3 weeks',
    approvalDeadline: '2026-10-01',
    status: 'Pending',
    clientDecision: '',
    clientComments: '',
    approvedDate: null,
    clientVisible: false,
    createdAt: 'now',
    createdBy: 'Ralph',
    ...over,
  };
}

// ── §9.3, the field that matters ────────────────────────────────────────────

test('§9.3 actualCost is ABSENT from the client shape, not removed from it', () => {
  // Built by literal, so a field added to SelectionRecord tomorrow cannot
  // appear here unless somebody adds it deliberately.
  const view = clientSelection(selection());

  assert.equal('actualCost' in view, false, 'the internal cost reached a client shape');
  assert.deepEqual(findInternalFields(view), []);
});

test('§9.3 the deny-list would catch it even if the shape grew the field', () => {
  // Belt and braces: two independent mechanisms, so neither is the only one.
  const leaky = { ...clientSelection(selection()), actualCost: 265 };
  assert.notDeepEqual(findInternalFields(leaky), []);
});

test('the client still sees the money they are entitled to', () => {
  // Dropping too much is its own failure. An allowance and an upgrade are
  // §9.3 allow-list, and a homeowner approving a selection needs both.
  const view = clientSelection(selection());
  assert.equal(view.allowance, 400);
  assert.equal(view.upgradeAmount, 120);
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

test('§ a scope with no contractor reads and writes nothing', async () => {
  const { repo } = recording();
  const none: TenantScope = { locationId: 'l', authProfileIds: ['p'] };

  await assert.rejects(() => repo.listSelections(none, 'p1'), TenancyError);
  await assert.rejects(() => repo.listChangeOrders(none, 'p1'), TenancyError);
  await assert.rejects(
    () => repo.createSelection(none, { projectId: 'p1', selectionName: 'x' }, { name: 'A' }),
    TenancyError,
  );
});

test('§ every read and edit is filtered on the asserted contractor', async () => {
  const { calls, repo } = recording();
  await repo.listSelections(SCOPE, 'p1');
  await repo.updateChangeOrder(SCOPE, 'c1', { status: 'Approved' });

  assert.equal((calls[0]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
  assert.equal((calls[1]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
});

test('archived rows never appear in a list', async () => {
  const { calls, repo } = recording();
  await repo.listChangeOrders(SCOPE, 'p1');
  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

// ── Money ───────────────────────────────────────────────────────────────────

test('a negative cost is refused rather than netting out silently', async () => {
  // A reduction is a credit, and there is a column for it. A negative added
  // cost would quietly misstate the contract total.
  const { repo } = recording();
  await assert.rejects(
    () =>
      repo.createChangeOrder(
        SCOPE,
        { projectId: 'p1', changeOrderNumber: 'CO-1', title: 'x', addedCost: -500 },
        { name: 'A' },
      ),
    /use the credit field/i,
  );
  await assert.rejects(
    () => repo.updateChangeOrder(SCOPE, 'c1', { creditAmount: -1 }),
    /cannot be negative/i,
  );
});

test('a new selection and change order are internal until released', async () => {
  const { calls, repo } = recording();
  await repo.createSelection(SCOPE, { projectId: 'p1', selectionName: 'x' }, { name: 'A' });
  await repo.createChangeOrder(
    SCOPE,
    { projectId: 'p1', changeOrderNumber: 'CO-1', title: 'x' },
    { name: 'A' },
  );

  for (const call of calls) {
    const row = (call.args.rows as Record<string, unknown>[])[0]!;
    assert.equal(row.client_visible, false);
    assert.equal(row.contractor_id, 'contractor-1');
  }
});

test('blank required fields are refused', async () => {
  const { repo } = recording();
  await assert.rejects(
    () => repo.createSelection(SCOPE, { projectId: 'p1', selectionName: '  ' }, { name: 'A' }),
    TypeError,
  );
  await assert.rejects(
    () =>
      repo.createChangeOrder(
        SCOPE,
        { projectId: 'p1', changeOrderNumber: '  ', title: 'x' },
        { name: 'A' },
      ),
    /needs a number/i,
  );
});

test('an edit writes only the fields it was given', async () => {
  const { calls, repo } = recording();
  await repo.updateSelection(SCOPE, 's1', { status: 'Ordered' });

  assert.deepEqual(Object.keys(calls[0]!.args.patch as object).sort(), ['status', 'updated_at']);
});

test('un-releasing reaches the database as false', async () => {
  const { calls, repo } = recording();
  await repo.updateSelection(SCOPE, 's1', { clientVisible: false });
  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('a cleared allowance is null, not zero', async () => {
  // "No allowance recorded" and "an allowance of nothing" are different
  // claims, and the second one appears on a client's screen.
  const { calls, repo } = recording();
  await repo.updateSelection(SCOPE, 's1', { allowance: null });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).allowance, null);
});

test('removal archives rather than deletes', async () => {
  const { calls, repo } = recording();
  await repo.archiveSelection(SCOPE, 's1', { name: 'Ralph' });

  assert.equal(calls[0]!.op, 'update');
  assert.equal((calls[0]!.args.patch as Record<string, unknown>).archived_by, 'Ralph');
  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

// ── The client's answer (2026-09-10) ────────────────────────────────────────

test('§ only a RELEASED record can be answered', async () => {
  // An unreleased record is one the contractor has not shown anybody. A client
  // answering it would be answering something they were never sent, so the
  // filter refuses rather than the screen remembering not to offer it.
  const { calls, repo } = recording();
  await repo.recordClientDecision(SCOPE, 'changeOrder', 'c1', { accepted: true });

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.client_visible, 'is.true');
  assert.equal(filters.archived_at, 'is.null');
  assert.equal(filters.contractor_id, 'eq.contractor-1');
});

test('approving records the date; declining does not', async () => {
  // An approval date on a rejected record would read as an approval that was
  // later reversed, which is a different history.
  const { calls, repo } = recording();
  await repo.recordClientDecision(SCOPE, 'selection', 's1', { accepted: true });
  await repo.recordClientDecision(SCOPE, 'selection', 's2', { accepted: false });

  const approved = calls[0]!.args.patch as Record<string, unknown>;
  const declined = calls[1]!.args.patch as Record<string, unknown>;

  assert.equal(approved.client_decision, 'Approved');
  assert.ok(approved.approved_date);
  assert.equal(declined.client_decision, 'Rejected');
  assert.equal(declined.approved_date, null);
});

test('a decision carries the client’s own words', async () => {
  const { calls, repo } = recording();
  await repo.recordClientDecision(SCOPE, 'changeOrder', 'c1', {
    accepted: false,
    comments: '  Too much for the tiling  ',
  });

  assert.equal(
    (calls[0]!.args.patch as Record<string, unknown>).client_comments,
    'Too much for the tiling',
  );
});

test('an empty comment is null rather than an empty answer', async () => {
  const { calls, repo } = recording();
  await repo.recordClientDecision(SCOPE, 'selection', 's1', { accepted: true, comments: '   ' });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_comments, null);
});

test('a decision goes to the right table', async () => {
  const { calls, repo } = recording();
  await repo.recordClientDecision(SCOPE, 'selection', 's1', { accepted: true });
  await repo.recordClientDecision(SCOPE, 'changeOrder', 'c1', { accepted: true });

  assert.equal(calls[0]!.args.from, 'hub_selections');
  assert.equal(calls[1]!.args.from, 'hub_change_orders');
});
