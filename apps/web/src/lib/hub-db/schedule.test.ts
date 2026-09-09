import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubSchedule } from './schedule.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

/** Records every call, so the tests can assert the filters and not just the result. */
function clientOf() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async insert(args: Record<string, unknown>) {
      calls.push({ op: 'insert', args });
      return [{ id: 'new-1', project_id: 'p1', title: 'x', created_at: 'now' }];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { calls, schedule: new HubSchedule(client as never) };
}

test('§ every read is filtered on the asserted contractor', async () => {
  const { calls, schedule } = clientOf();
  await schedule.listForProject(SCOPE, 'p1');

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.contractor_id, 'eq.contractor-1');
  assert.equal(filters.project_id, 'eq.p1');
});

test('archived appointments never appear in a list', async () => {
  // Excluded here rather than at each call site, so a new screen cannot show
  // cancelled-and-archived work by forgetting to filter.
  const { calls, schedule } = clientOf();
  await schedule.listForProject(SCOPE, 'p1');

  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

test('§ a scope with no contractor reads nothing rather than everything', async () => {
  const { schedule } = clientOf();
  const noContractor: TenantScope = { locationId: 'loc-1', authProfileIds: ['profile-1'] };

  await assert.rejects(() => schedule.listForProject(noContractor, 'p1'), TenancyError);
  await assert.rejects(
    () => schedule.create(noContractor, { projectId: 'p1', title: 'x' }, { name: 'A' }),
    TenancyError,
  );
});

test('a new appointment is internal until someone releases it', async () => {
  // A checkbox defaulting to on would publish a date nobody had confirmed.
  const { calls, schedule } = clientOf();
  await schedule.create(SCOPE, { projectId: 'p1', title: 'Framing' }, { name: 'Ralph' });

  const row = (calls[0]!.args.rows as Record<string, unknown>[])[0]!;
  assert.equal(row.client_visible, false);
  assert.equal(row.contractor_id, 'contractor-1');
  assert.equal(row.created_by, 'Ralph');
});

test('an appointment that ends before it starts is refused', async () => {
  // A schedule that renders backwards is worse than a rejected entry.
  const { schedule } = clientOf();
  await assert.rejects(
    () =>
      schedule.create(
        SCOPE,
        { projectId: 'p1', title: 'x', startsAt: '2026-09-10T12:00', endsAt: '2026-09-10T08:00' },
        { name: 'A' },
      ),
    /cannot end before it starts/i,
  );
});

test('a blank title is refused on create and on update', async () => {
  const { schedule } = clientOf();
  await assert.rejects(() => schedule.create(SCOPE, { projectId: 'p1', title: '   ' }, { name: 'A' }), TypeError);
  await assert.rejects(() => schedule.update(SCOPE, 'i1', { title: '  ' }, { name: 'A' }), TypeError);
});

test('§ an edit is filtered on the contractor as well as the row id', async () => {
  // Knowing an id must not be enough to change another contractor's schedule.
  const { calls, schedule } = clientOf();
  await schedule.update(SCOPE, 'item-9', { status: 'Complete' }, { name: 'A' });

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.id, 'eq.item-9');
  assert.equal(filters.contractor_id, 'eq.contractor-1');
});

test('an edit writes only the fields it was given', async () => {
  // A patch that always wrote every column would blank a title when the caller
  // only meant to change a status.
  const { calls, schedule } = clientOf();
  await schedule.update(SCOPE, 'item-9', { status: 'Complete' }, { name: 'A' });

  const patch = calls[0]!.args.patch as Record<string, unknown>;
  assert.deepEqual(Object.keys(patch).sort(), ['status', 'updated_at']);
});

test('releasing and un-releasing are both possible', async () => {
  // `clientVisible: false` must reach the database as false, not be dropped as
  // falsy — otherwise un-publishing an appointment silently does nothing.
  const { calls, schedule } = clientOf();
  await schedule.update(SCOPE, 'i1', { clientVisible: false }, { name: 'A' });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('removal archives rather than deletes', async () => {
  const { calls, schedule } = clientOf();
  await schedule.archive(SCOPE, 'i1', { name: 'Ralph' });

  assert.equal(calls[0]!.op, 'update', 'a delete would lose that the appointment existed');
  const patch = calls[0]!.args.patch as Record<string, unknown>;
  assert.ok(patch.archived_at);
  assert.equal(patch.archived_by, 'Ralph');
});

test('archiving an already-archived row is a no-op, not a re-stamp', async () => {
  const { calls, schedule } = clientOf();
  await schedule.archive(SCOPE, 'i1', { name: 'A' });

  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});
