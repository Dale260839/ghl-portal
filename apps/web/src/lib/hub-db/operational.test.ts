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
