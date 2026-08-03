/**
 * The invariants from ARCHITECTURE.md §3 as executable tests. §0: "Every MUST /
 * MUST NOT is a hard invariant. Violating one is a defect, regardless of test
 * results." These are the subset that can be proven in isolation.
 *
 * Run: node --test src/*.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_STAGES_SEQUENTIAL,
  PROJECT_STAGES_NON_LINEAR,
  MANAGER_APPROVAL_STATUSES,
  TASK_STATUSES,
  ISSUE_CATEGORIES,
} from './enums.ts';
import { assertProjectId, formatProjectId, isProjectId, TEST_PROJECT_ID } from './ids.ts';
import {
  INTERNAL_FIELD_DENY_LIST,
  assertNoInternalFields,
  findInternalFields,
  isInternalField,
  stripInternalFields,
} from './deny-list.ts';
import { clientCanSee, evaluateGate, filterForClient, isActionAllowed } from './gate.ts';
import { assertHandoffPayload, validateHandoffPayload } from './handoff.ts';

// ── §5 shared key ────────────────────────────────────────────────────────────

test('§5 project ID accepts the canonical format and rejects near-misses', () => {
  assert.ok(isProjectId('BSP-2026-000184'));
  assert.ok(!isProjectId('BSP-2026-184'), '6-digit sequence is required');
  assert.ok(!isProjectId('bsp-2026-000184'), 'casing is part of the contract');
  assert.ok(!isProjectId('BSP-2026-000184 '), 'no surrounding whitespace');
  assert.ok(!isProjectId(TEST_PROJECT_ID), 'fixtures are not production IDs');
  assert.equal(formatProjectId(2026, 184), 'BSP-2026-000184');
});

test('§5 an unparseable ID throws rather than defaulting', () => {
  assert.throws(() => assertProjectId(undefined), TypeError);
  assert.throws(() => assertProjectId('Johnson Kitchen Remodel'), TypeError);
  assert.equal(assertProjectId(TEST_PROJECT_ID), TEST_PROJECT_ID);
});

// ── §7 pipeline ──────────────────────────────────────────────────────────────

test('§7 pipeline is 19 sequential stages plus 2 non-linear, verbatim', () => {
  assert.equal(PROJECT_STAGES_SEQUENTIAL.length, 19);
  assert.equal(PROJECT_STAGES_NON_LINEAR.length, 2);
  assert.equal(PROJECT_STAGES_SEQUENTIAL[0], 'New Project');
  assert.equal(PROJECT_STAGES_SEQUENTIAL.at(-1), 'Warranty');
  assert.deepEqual([...PROJECT_STAGES_NON_LINEAR], ['On Hold', 'Canceled']);
});

test('§6 enums keep their exact counts and spellings', () => {
  assert.equal(TASK_STATUSES.length, 9);
  assert.ok(TASK_STATUSES.includes('Waiting on Inspection'));
  assert.equal(ISSUE_CATEGORIES.length, 11);
  assert.ok(ISSUE_CATEGORIES.includes('Safety Concern'));
  assert.deepEqual(
    [...MANAGER_APPROVAL_STATUSES],
    ['Pending', 'Returned', 'Approved Internally', 'Approved & Published'],
  );
});

// ── §9.3 deny-list ───────────────────────────────────────────────────────────

test('§9.3 every deny-listed field is caught in all three casings', () => {
  for (const field of INTERNAL_FIELD_DENY_LIST) {
    const snake = field.toLowerCase().replace(/ /g, '_');
    const camel = field
      .split(' ')
      .map((w, i) => (i === 0 ? w.toLowerCase() : w))
      .join('');
    assert.ok(isInternalField(field), `${field} (display)`);
    assert.ok(isInternalField(snake), `${snake} (snake)`);
    assert.ok(isInternalField(camel), `${camel} (camel)`);
  }
});

test('§9.3 internal fields are stripped from nested structures', () => {
  const response = {
    projectName: 'Johnson Kitchen Remodel',
    contractAmount: 48_500,
    internalPriority: 'High',
    dailyUpdates: [
      {
        clientSummary: 'Cabinets installed.',
        internal_notes: 'Sub was 3 hours late again.',
        'Delay Reason': 'crew shortage',
      },
    ],
    selections: { product: 'Kohler K-2661', allowance: 400, vendorCost: 212.5 },
  };

  assert.deepEqual(findInternalFields(response).sort(), [
    '$.dailyUpdates[0].Delay Reason',
    '$.dailyUpdates[0].internal_notes',
    '$.internalPriority',
    '$.selections.vendorCost',
  ]);

  const safe = stripInternalFields(response);
  assert.doesNotThrow(() => assertNoInternalFields(safe));
  assert.equal(safe.projectName, 'Johnson Kitchen Remodel');
  assert.equal(safe.contractAmount, 48_500, 'allow-listed financials survive');
  assert.equal(safe.selections.allowance, 400);
  assert.equal(safe.dailyUpdates[0]!.clientSummary, 'Cabinets installed.');
});

test('§9.3 assertNoInternalFields fails loudly on a leak', () => {
  assert.throws(
    () => assertNoInternalFields({ margin: 0.32 }, 'portal /projects response'),
    /§9.3 violation: portal \/projects response contains internal field\(s\): \$\.margin/,
  );
});

// ── §9.1 the gate ────────────────────────────────────────────────────────────

const PROJECT_A = 'BSP-2026-000184';
const PROJECT_B = 'BSP-2026-000185';
const portalOn = { clientPortalEnabled: true };
const clientA = { associatedProjectIds: [PROJECT_A] };

const published = {
  clientVisible: true,
  managerApprovalStatus: 'Approved & Published' as const,
  projectId: PROJECT_A,
};

test('§9.1 all four clauses must hold', () => {
  assert.ok(clientCanSee(published, portalOn, clientA));

  assert.deepEqual(evaluateGate({ ...published, clientVisible: false }, portalOn, clientA), {
    allowed: false,
    reason: 'client_visible_false',
  });
  assert.deepEqual(evaluateGate(published, { clientPortalEnabled: false }, clientA), {
    allowed: false,
    reason: 'client_portal_disabled',
  });
});

test('§10 "Approved Internally" does NOT reach the client', () => {
  assert.deepEqual(
    evaluateGate(
      { ...published, managerApprovalStatus: 'Approved Internally' },
      portalOn,
      clientA,
    ),
    { allowed: false, reason: 'manager_approval_not_published' },
  );
  for (const status of ['Pending', 'Returned'] as const) {
    assert.ok(!clientCanSee({ ...published, managerApprovalStatus: status }, portalOn, clientA));
  }
});

test('§9.1 "(where applicable)" — a null approval status skips that clause', () => {
  assert.ok(clientCanSee({ ...published, managerApprovalStatus: null }, portalOn, clientA));
});

test('§9.1 no cross-project leakage', () => {
  assert.deepEqual(evaluateGate({ ...published, projectId: PROJECT_B }, portalOn, clientA), {
    allowed: false,
    reason: 'contact_not_associated',
  });
});

test('§1.4 a contact with multiple projects sees all of them', () => {
  const clientAB = { associatedProjectIds: [PROJECT_A, PROJECT_B] };
  const records = [
    published,
    { ...published, projectId: PROJECT_B },
    { ...published, projectId: 'BSP-2026-000999' },
    { ...published, projectId: PROJECT_A, clientVisible: false },
  ];
  const visible = filterForClient(records, portalOn, clientAB);
  assert.equal(visible.length, 2);
  assert.deepEqual(
    visible.map((r) => r.projectId),
    [PROJECT_A, PROJECT_B],
  );
});

// ── §9.2 auth tiers ──────────────────────────────────────────────────────────

test('§9.2 email + Project ID gates nothing that matters', () => {
  for (const action of ['approvals', 'payments', 'documents', 'private_messages', 'warranty'] as const) {
    assert.ok(!isActionAllowed(action, 'email_and_project_id'), action);
    assert.ok(isActionAllowed(action, 'portal_login'), action);
  }
});

// ── §8.2 handoff ─────────────────────────────────────────────────────────────

const validHandoff = {
  buildsuite_project_id: 'BSP-2026-000184',
  project_name: 'Johnson Kitchen Remodel',
  project_address: '1400 Broadway, San Antonio, TX',
  contract_amount: 48_500.0,
  client: { name: 'Dana Johnson', email: 'dana@example.com', phone: '+12105550137' },
};

test('§8.2 a well-formed handoff payload validates', () => {
  assert.deepEqual(validateHandoffPayload(validHandoff), []);
  assert.equal(assertHandoffPayload(validHandoff).buildsuite_project_id, 'BSP-2026-000184');
});

test('§8.2 validation reports every problem at once, not just the first', () => {
  const issues = validateHandoffPayload({
    buildsuite_project_id: 'BSP-184',
    project_name: '',
    contract_amount: 'forty eight thousand',
    client: { name: 'Dana Johnson' },
  });
  assert.deepEqual(issues.map((i) => i.field).sort(), [
    'buildsuite_project_id',
    'client.email',
    'client.phone',
    'contract_amount',
    'project_address',
    'project_name',
  ]);
});

test('§3.6 a payload identified only by name is rejected', () => {
  assert.throws(
    () => assertHandoffPayload({ ...validHandoff, buildsuite_project_id: undefined }),
    /buildsuite_project_id/,
  );
});
