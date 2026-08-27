/**
 * The permission matrix.
 *
 * The tests worth having here are the ones that would catch the matrix being
 * *widened* by accident — a role gaining delete, a field user gaining publish,
 * anyone gaining the ability to complete a stage. Those are the changes that
 * look harmless in a diff.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PermissionError,
  allowedActions,
  assertCan,
  can,
  ownsAsClient,
  ownsTask,
  type Resource,
} from './permissions.ts';
import type { Role } from './demo-accounts.ts';

const ROLES: Role[] = ['contractor', 'field', 'client'];
const RESOURCES: Resource[] = [
  'project',
  'milestone',
  'task',
  'dailyUpdate',
  'selection',
  'changeOrder',
  'document',
  'photo',
  'message',
  'issue',
  'punchList',
  'warranty',
  'visibilitySettings',
  'invoice',
];

// ── The contractor is not read-only ─────────────────────────────────────────
// §12.1: the dashboard "creates and controls everything the other two
// experiences display".

test('§12.1 a contractor can create, read, update and delete every operational record', () => {
  const operational: Resource[] = [
    'project',
    'milestone',
    'task',
    'dailyUpdate',
    'selection',
    'changeOrder',
    'document',
    'photo',
    'message',
    'issue',
    'punchList',
    'warranty',
    'invoice',
  ];

  for (const resource of operational) {
    for (const action of ['create', 'read', 'update', 'delete'] as const) {
      assert.equal(
        can('contractor', action, resource),
        true,
        `a contractor should be able to ${action} a ${resource}`,
      );
    }
  }
});

test('a contractor owns every publish decision', () => {
  for (const resource of RESOURCES) {
    if (allowedActions('contractor', resource).includes('publish')) continue;
    // Not every resource is publishable; those that are must be contractor-only.
    for (const role of ROLES) {
      assert.equal(can(role, 'publish', resource), false);
    }
  }

  for (const resource of RESOURCES) {
    if (!can('contractor', 'publish', resource)) continue;
    assert.equal(can('field', 'publish', resource), false, `field can publish a ${resource}`);
    assert.equal(can('client', 'publish', resource), false, `client can publish a ${resource}`);
  }
});

// ── Exception 1 · stage completion belongs to GoHighLevel ───────────────────

test('D4 §5 — no role can complete a stage from the Hub', () => {
  for (const role of ROLES) {
    for (const resource of RESOURCES) {
      assert.equal(
        can(role, 'completeStage', resource),
        false,
        `${role} can complete a stage — GHL owns stage movement, the Hub reflects it`,
      );
    }
  }
});

// ── Exception 2 · the crew submits, it never publishes ──────────────────────

test('§12.2 a field user can write a daily update but never publish one', () => {
  assert.equal(can('field', 'create', 'dailyUpdate'), true);
  assert.equal(can('field', 'update', 'dailyUpdate'), true);
  assert.equal(can('field', 'publish', 'dailyUpdate'), false);
});

test('§12.2 a field user can progress a task but not create or delete one', () => {
  assert.equal(can('field', 'update', 'task'), true, 'the crew starts and completes their work');
  assert.equal(can('field', 'create', 'task'), false, 'the office assigns work');
  assert.equal(can('field', 'delete', 'task'), false);
});

// ── Exception 3 · only a contractor deletes ─────────────────────────────────

test('neither a field user nor a client can delete anything', () => {
  for (const resource of RESOURCES) {
    assert.equal(can('field', 'delete', resource), false, `field can delete a ${resource}`);
    assert.equal(can('client', 'delete', resource), false, `client can delete a ${resource}`);
  }
});

// ── Exception 4 · money ─────────────────────────────────────────────────────

test('§9.3 / §9.4 no field or client write reaches an invoice, and neither reads one', () => {
  for (const action of ['create', 'read', 'update', 'delete'] as const) {
    assert.equal(can('field', action, 'invoice'), false, `field can ${action} an invoice`);
    assert.equal(can('client', action, 'invoice'), false, `client can ${action} an invoice`);
  }
});

test('the visibility switches are the contractor’s alone, including reading them', () => {
  for (const role of ['field', 'client'] as const) {
    assert.equal(can(role, 'read', 'visibilitySettings'), false);
    assert.equal(can(role, 'update', 'visibilitySettings'), false);
  }
  assert.equal(can('contractor', 'update', 'visibilitySettings'), true);
});

// ── What a client may do ────────────────────────────────────────────────────

test('a client approves selections and change orders but never edits them', () => {
  for (const resource of ['selection', 'changeOrder'] as const) {
    assert.equal(can('client', 'approve', resource), true);
    assert.equal(can('client', 'update', resource), false, 'the terms are the contractor’s to set');
    assert.equal(can('client', 'create', resource), false);
  }
});

test('a client can raise an issue, send a message, and request warranty work', () => {
  assert.equal(can('client', 'create', 'issue'), true);
  assert.equal(can('client', 'create', 'message'), true);
  assert.equal(can('client', 'create', 'warranty'), true);
});

test('a client cannot see a change order thread they are not party to — by resource', () => {
  // The field crew has no business in the client's commercial conversation.
  assert.equal(can('field', 'read', 'changeOrder'), false);
});

// ── assertCan ───────────────────────────────────────────────────────────────

test('assertCan throws with a message naming role, action and resource', () => {
  assert.throws(
    () => assertCan('field', 'publish', 'dailyUpdate'),
    (error: unknown) => {
      assert.ok(error instanceof PermissionError);
      assert.match(error.message, /field may not publish a dailyUpdate/);
      return true;
    },
  );
});

test('assertCan is silent when the role may act', () => {
  assert.doesNotThrow(() => assertCan('contractor', 'delete', 'task'));
  assert.doesNotThrow(() => assertCan('field', 'create', 'dailyUpdate'));
});

test('an unknown action on a resource is refused, not allowed by default', () => {
  // Absent from the matrix must mean no, or every future action starts open.
  assert.equal(can('contractor', 'approve', 'photo'), false);
  assert.equal(can('contractor', 'publish', 'invoice'), false);
});

// ── Ownership is a separate question ────────────────────────────────────────

test('a field user acts only on tasks assigned to them', () => {
  const tony = { role: 'field' as const, name: 'Tony Alvarez' };

  assert.equal(ownsTask(tony, { assignedTo: 'Tony Alvarez' }), true);
  assert.equal(ownsTask(tony, { assignedTo: 'Someone Else' }), false);
  assert.equal(ownsTask(tony, { assignedTo: null }), false, 'unassigned is nobody’s');
});

test('a contractor owns every record; a client owns no task', () => {
  assert.equal(ownsTask({ role: 'contractor', name: 'Marcus' }, { assignedTo: null }), true);
  assert.equal(ownsTask({ role: 'client', name: 'Dana' }, { assignedTo: 'Dana' }), false);
});

test('a client acts only on their own contact’s records', () => {
  const dana = { role: 'client' as const, contactId: 'contact-johnson' };

  assert.equal(ownsAsClient(dana, { contactId: 'contact-johnson' }), true);
  assert.equal(ownsAsClient(dana, { contactId: 'contact-someone-else' }), false);
  assert.equal(
    ownsAsClient({ role: 'client', contactId: undefined }, { contactId: 'contact-johnson' }),
    false,
    'a client session with no contact owns nothing',
  );
});

// ── The matrix stays closed by default ──────────────────────────────────────

test('every role/resource pair is an explicit yes or an explicit no', () => {
  // Nothing throws, nothing returns undefined — `can` is total.
  for (const role of ROLES) {
    for (const resource of RESOURCES) {
      for (const action of ['create', 'read', 'update', 'delete', 'publish', 'approve', 'completeStage'] as const) {
        assert.equal(typeof can(role, action, resource), 'boolean');
      }
    }
  }
});
