import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubOperational } from './operational.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

/** Records every call, so a test can assert the filters and not just the result. */
function recordingOps() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async insert(args: Record<string, unknown>) {
      calls.push({ op: 'insert', args });
      return [{ id: 'new-1', project_id: 'p1', milestone_name: 'x', sequence: 1 }];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { calls, ops: new HubOperational(client as never) };
}

test('§ a scope with no contractor writes nothing', async () => {
  const { ops } = recordingOps();
  const noContractor: TenantScope = { locationId: 'loc-1', authProfileIds: ['profile-1'] };

  await assert.rejects(
    () => ops.updateMilestone(noContractor, 'm-1', { status: 'Completed' }),
    TenancyError,
  );
  await assert.rejects(
    () => ops.archiveMilestone(noContractor, 'm-1', { name: 'A' }),
    TenancyError,
  );
});

// ── Milestone edit and archive (2026-09-09) ─────────────────────────────────

test('§ a milestone edit is filtered on the contractor as well as the id', async () => {
  // Knowing an id must not be enough to change another contractor's plan.
  const { calls, ops } = recordingOps();
  await ops.updateMilestone(SCOPE, 'm-9', { status: 'Completed' });

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.id, 'eq.m-9');
  assert.equal(filters.contractor_id, `eq.${SCOPE.contractorId}`);
});

test('a milestone edit writes only the fields it was given', async () => {
  const { calls, ops } = recordingOps();
  await ops.updateMilestone(SCOPE, 'm-9', { status: 'Completed' });

  assert.deepEqual(Object.keys(calls[0]!.args.patch as object).sort(), ['status', 'updated_at']);
});

test('un-releasing a milestone reaches the database as false', async () => {
  // Dropped as falsy, it would silently fail to un-publish.
  const { calls, ops } = recordingOps();
  await ops.updateMilestone(SCOPE, 'm-9', { clientVisible: false });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('a blank milestone name is refused', async () => {
  const { ops } = recordingOps();
  await assert.rejects(() => ops.updateMilestone(SCOPE, 'm-9', { milestoneName: '  ' }), TypeError);
});

test('removing a milestone archives rather than deletes', async () => {
  const { calls, ops } = recordingOps();
  await ops.archiveMilestone(SCOPE, 'm-9', { name: 'Ralph' });

  assert.equal(calls[0]!.op, 'update');
  const patch = calls[0]!.args.patch as Record<string, unknown>;
  assert.ok(patch.archived_at);
  assert.equal(patch.archived_by, 'Ralph');
  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

// ── Milestones: the columns create, read and update must agree on ────────────

test('editing a milestone writes the SAME columns creating one wrote', async () => {
  // `updateMilestone` wrote `target_date` and `completed_date` — the pair
  // migration 0001 created — while `createMilestone` writes `planned_start` and
  // `planned_end`, added by 0003, and `toMilestone` reads that pair.
  //
  // So editing a milestone's dates appeared to work and changed nothing on
  // screen. Worse, an end date landed in `completed_date`, giving a milestone
  // nobody had finished a completion date that a later report or stage sync
  // would take at face value.
  const created = recordingOps();
  await created.ops.createMilestone(SCOPE, {
    projectId: 'p1',
    milestoneName: 'Framing',
    sequence: 2,
    plannedStart: '2026-09-01',
    plannedEnd: '2026-09-14',
    createdBy: 'Ralph',
  });
  const insert = created.calls.find((c) => c.op === 'insert')!.args as {
    rows: Record<string, unknown>[];
  };
  const written = insert.rows[0]!;

  const edited = recordingOps();
  await edited.ops.updateMilestone(SCOPE, 'm-1', {
    plannedStart: '2026-09-02',
    plannedEnd: '2026-09-15',
  });
  const patch = (edited.calls.find((c) => c.op === 'update')!.args as { patch: Record<string, unknown> })
    .patch;

  for (const column of ['planned_start', 'planned_end']) {
    assert.ok(column in written, `create does not write ${column}`);
    assert.ok(column in patch, `update does not write ${column}`);
  }
  assert.equal(patch.planned_start, '2026-09-02');
  assert.equal(patch.planned_end, '2026-09-15');
});

test('editing a milestone never sets a completion date', async () => {
  // The half of the bug that survives a screen refresh. A milestone is
  // completed by someone saying so, never as a side effect of moving its dates.
  const { ops, calls } = recordingOps();
  await ops.updateMilestone(SCOPE, 'm-1', {
    plannedStart: '2026-09-02',
    plannedEnd: '2026-09-15',
    status: 'In Progress',
  });
  const patch = (calls.find((c) => c.op === 'update')!.args as { patch: Record<string, unknown> })
    .patch;

  assert.equal('completed_date' in patch, false, 'an edit marked the milestone complete');
  assert.equal('target_date' in patch, false, 'an edit wrote a column nothing reads');
});

test('a milestone edit touches only the fields it was given', async () => {
  // A patch that wrote every column would blank a name when the caller meant
  // to change a status.
  const { ops, calls } = recordingOps();
  await ops.updateMilestone(SCOPE, 'm-1', { status: 'Completed' });
  const patch = (calls.find((c) => c.op === 'update')!.args as { patch: Record<string, unknown> })
    .patch;

  assert.deepEqual(Object.keys(patch).sort(), ['status', 'updated_at']);
});
