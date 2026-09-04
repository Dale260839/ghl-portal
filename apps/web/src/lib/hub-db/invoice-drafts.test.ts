import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubInvoiceDrafts } from './invoice-drafts.ts';
import { paymentScheduleDrafts } from '../payment-schedule.ts';

const SCOPE = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

/** Records what reached the database, so tenancy can be asserted on the call. */
function spyClient() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async upsert(args: Record<string, unknown>, onConflict: string) {
      calls.push({ op: 'upsert', args: { ...args, onConflict } });
      return [];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { client, calls };
}

const SCHEDULE = `
## PAYMENT SCHEDULE

- **50%** upon acceptance of this contract and project scheduling
- **25%** upon start of construction
- **25%** upon completion of punch list

---
`;

test('every read is filtered by the contractor, not only the proposal', () => {
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  return repo.listForProposal(SCOPE, 'proposal-1').then(() => {
    const filters = calls[0]!.args.filters as Record<string, string>;
    assert.equal(filters.contractor_id, 'eq.contractor-1');
    assert.equal(filters.proposal_id, 'eq.proposal-1');
  });
});

test('a scope with no resolved contractor is refused, not defaulted', async () => {
  const { client } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await assert.rejects(
    () => repo.listForProposal({ locationId: 'loc-1', authProfileIds: ['p'] }, 'proposal-1'),
    /contractor/i,
  );
});

test('seeding upserts on the line, so re-opening does not double an invoice', async () => {
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await repo.seedFromSchedule(
    SCOPE,
    { projectId: 'p1', proposalId: 'prop-1', drafts: paymentScheduleDrafts(SCHEDULE, null) },
    { name: 'Ralph' },
  );

  const call = calls.find((c) => c.op === 'upsert');
  assert.ok(call);
  assert.equal(
    call.args.onConflict,
    'proposal_id,line_order',
    'two drafts for one instalment is two invoices that could both be sent',
  );
  assert.equal((call.args.rows as unknown[]).length, 3);
});

test('seeding never writes the contractor-supplied fields', async () => {
  // Otherwise re-opening the screen would wipe work somebody had already done.
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await repo.seedFromSchedule(
    SCOPE,
    { projectId: 'p1', proposalId: 'prop-1', drafts: paymentScheduleDrafts(SCHEDULE, 100000) },
    { name: 'Ralph' },
  );

  const rows = (calls.find((c) => c.op === 'upsert')!.args.rows as Record<string, unknown>[]);
  for (const row of rows) {
    for (const field of ['title', 'amount', 'description', 'notes']) {
      assert.equal(field in row, false, `seeding wrote ${field}`);
    }
  }
});

test('a computed amount is not stored as something the proposal said', async () => {
  // With a contract total the draft CAN compute 50000, but the proposal stated
  // no figure. Storing the derivation in `source_amount` would later be
  // indistinguishable from the document having said it.
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  const drafts = paymentScheduleDrafts(SCHEDULE, 100000);
  assert.equal(drafts[0]!.amount, 50000, 'the fixture must actually compute one');

  await repo.seedFromSchedule(
    SCOPE,
    { projectId: 'p1', proposalId: 'prop-1', drafts },
    { name: 'Ralph' },
  );

  const rows = calls.find((c) => c.op === 'upsert')!.args.rows as Record<string, unknown>[];
  assert.equal(rows[0]!.source_amount, null, 'a computed figure was stored as stated');
  assert.equal(rows[0]!.source_percent, 50);
});

test('saving is filtered by contractor and refuses a sent invoice', async () => {
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await repo.save(SCOPE, 'draft-9', { amount: 1200 }, { name: 'Ralph' });

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.id, 'eq.draft-9');
  assert.equal(filters.contractor_id, 'eq.contractor-1', 'another contractor could be edited');
  assert.equal(
    filters.status,
    'in.(draft,ready)',
    'editing a sent invoice changes a document the homeowner already has',
  );
});

test('a negative amount is refused', async () => {
  const { client } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await assert.rejects(
    () => repo.save(SCOPE, 'draft-9', { amount: -1 }, { name: 'Ralph' }),
    /negative/i,
  );
});

test('clearing an amount is allowed and is not the same as zero', async () => {
  const { client, calls } = spyClient();
  const repo = new HubInvoiceDrafts(client as never);

  await repo.save(SCOPE, 'draft-9', { amount: null }, { name: 'Ralph' });
  const patch = calls[0]!.args.patch as Record<string, unknown>;
  assert.equal(patch.amount, null);
  assert.notEqual(patch.amount, 0);
});
