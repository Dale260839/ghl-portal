import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HubOperational,
  isPunchItem,
  ISSUE_STATUS_FOR_PUNCH,
  PUNCH_CATEGORY,
  punchItemFromIssue,
} from './operational.ts';
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
      return [
        {
          id: 'new-1',
          project_id: 'p1',
          milestone_name: 'x',
          sequence: 1,
          // Every table stamps this, and the issue mapper reads it for the
          // submitted date. A stub row without one is not a row this code
          // could ever receive.
          created_at: '2026-09-10T00:00:00.000Z',
        },
      ];
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

// ── Issues and the punch list (2026-09-10) ──────────────────────────────────

test('§ an issue edit and an archive both refuse a scope with no contractor', async () => {
  const { ops } = recordingOps();
  const noContractor: TenantScope = { locationId: 'loc-1', authProfileIds: ['profile-1'] };

  await assert.rejects(
    () => ops.updateIssue(noContractor, 'i-1', { status: 'Resolved' }),
    TenancyError,
  );
  await assert.rejects(() => ops.archiveIssue(noContractor, 'i-1', { name: 'A' }), TenancyError);
  await assert.rejects(
    () =>
      ops.createIssue(noContractor, {
        projectId: 'p1',
        issueTitle: 'x',
        raisedBy: 'A',
        raisedByRole: 'field',
      }),
    TenancyError,
  );
});

test('§ listing issues filters on the contractor and excludes archived rows', async () => {
  const { calls, ops } = recordingOps();
  await ops.listIssues(SCOPE, 'p1');

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.contractor_id, `eq.${SCOPE.contractorId}`);
  assert.equal(filters.project_id, 'eq.p1');
  assert.equal(filters.archived_at, 'is.null');
});

test('§ an issue edit is filtered on the contractor as well as the id', async () => {
  // Knowing an id must not be enough to change another contractor's record.
  const { calls, ops } = recordingOps();
  await ops.updateIssue(SCOPE, 'i-9', { status: 'In Progress' });

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.id, 'eq.i-9');
  assert.equal(filters.contractor_id, `eq.${SCOPE.contractorId}`);
});

test('an issue edit writes only the fields it was given', async () => {
  const { calls, ops } = recordingOps();
  await ops.updateIssue(SCOPE, 'i-9', { assignedTo: 'Marcus' });

  assert.deepEqual(Object.keys(calls[0]!.args.patch as object).sort(), [
    'assigned_to',
    'updated_at',
  ]);
});

test('resolving an issue stamps resolved_at; reopening it clears the stamp', async () => {
  // Derived from the status rather than passed in, so the two cannot drift.
  const { calls, ops } = recordingOps();
  await ops.updateIssue(SCOPE, 'i-9', { status: 'Resolved' });
  assert.ok((calls[0]!.args.patch as Record<string, unknown>).resolved_at);

  await ops.updateIssue(SCOPE, 'i-9', { status: 'Open' });
  assert.equal((calls[1]!.args.patch as Record<string, unknown>).resolved_at, null);
});

test('withdrawing an issue from the client reaches the database as false', async () => {
  // Dropped as falsy, it would silently fail to un-publish.
  const { calls, ops } = recordingOps();
  await ops.updateIssue(SCOPE, 'i-9', { clientVisible: false });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('a blank issue title is refused', async () => {
  const { ops } = recordingOps();
  await assert.rejects(
    () =>
      ops.createIssue(SCOPE, {
        projectId: 'p1',
        issueTitle: '   ',
        raisedBy: 'A',
        raisedByRole: 'field',
      }),
    TypeError,
  );
});

test('a new issue is filed under the contractor, numbered, and hidden from the client', async () => {
  const { calls, ops } = recordingOps();
  await ops.createIssue(SCOPE, {
    projectId: 'p1',
    issueTitle: 'Water in the trench',
    raisedBy: 'Marcus',
    raisedByRole: 'field',
  });

  // First the count that produces the reference, scoped to the tenant.
  assert.equal(calls[0]!.op, 'select');
  assert.equal(
    (calls[0]!.args.filters as Record<string, string>).contractor_id,
    `eq.${SCOPE.contractorId}`,
  );

  const rows = calls[1]!.args.rows as Record<string, unknown>[];
  assert.equal(rows[0]!.contractor_id, SCOPE.contractorId);
  // The recording client returns no existing rows, so this is the first.
  assert.equal(rows[0]!.issue_number, '001');
  // Internal by default. Releasing is a separate, contractor-only decision.
  assert.equal(rows[0]!.client_visible, false);
  assert.equal(rows[0]!.priority, 'Normal');
});

test('removing an issue archives rather than deletes', async () => {
  const { calls, ops } = recordingOps();
  await ops.archiveIssue(SCOPE, 'i-9', { name: 'Ralph' });

  assert.equal(calls[0]!.op, 'update');
  const patch = calls[0]!.args.patch as Record<string, unknown>;
  assert.ok(patch.archived_at);
  assert.equal(patch.archived_by, 'Ralph');
  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

test('a punch item is told from an issue by its category, nothing else', () => {
  assert.equal(isPunchItem({ category: PUNCH_CATEGORY }), true);
  assert.equal(isPunchItem({ category: 'Damage' }), false);
});

test('the punch vocabulary maps onto the issue statuses in both directions', () => {
  assert.deepEqual(ISSUE_STATUS_FOR_PUNCH, {
    Open: 'Open',
    Scheduled: 'In Progress',
    Completed: 'Resolved',
    Verified: 'Closed',
  });

  const item = punchItemFromIssue({
    id: 'i-1',
    projectId: 'p1',
    issueNumber: '004',
    issueTitle: 'Touch up paint',
    category: 'Other',
    description: 'Scuff by the pantry door',
    projectArea: 'Kitchen',
    priority: 'Normal',
    reportedBy: 'Marcus',
    assignedTo: null,
    submittedDate: '2026-09-10',
    targetResolutionDate: null,
    status: 'Resolved',
    internalNotes: 'used the leftover tin',
    clientUpdate: '',
    resolution: '',
    clientConfirmation: false,
    clientVisible: false,
    raisedByRole: 'client',
    resolvedAt: '2026-09-11T04:00:00.000Z',
  });

  assert.equal(item.status, 'Completed');
  assert.equal(item.itemNumber, '004');
  assert.equal(item.location, 'Kitchen');
  assert.equal(item.raisedByClient, true);
  assert.equal(item.completedDate, '2026-09-11');
  // §9.3 — the internal note rides along on the CONTRACTOR side. The client
  // projection in `portal-gates.ts` is what drops it.
  assert.equal(item.internalNotes, 'used the leftover tin');
});
