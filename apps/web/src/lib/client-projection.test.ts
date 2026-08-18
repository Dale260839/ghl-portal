/**
 * The leak checks, as tests.
 *
 * These were verified by hand against the running app once. Hand-verification
 * proves the app was safe on the day it was run; a test proves it stays safe.
 * §9.3 is the rule most likely to be broken by a well-meaning future change —
 * someone adds a field to the client DTO "just for the schedule view" and takes
 * a cost field with it.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INTERNAL_FIELD_DENY_LIST } from '@buildsuite/contracts';
import { toClientMilestones, toClientProject, toClientUpdates } from './client-projection.ts';
import { CONTACTS, DAILY_UPDATES, MILESTONES, PROJECTS } from './data/fixtures.ts';
import type { Contact, Project } from './data/types.ts';

const johnson = CONTACTS.find((c) => c.id === 'contact-johnson')!;
const whitfield = CONTACTS.find((c) => c.id === 'contact-whitfield')!;
const kitchen = PROJECTS.find((p) => p.buildsuiteProjectId === 'BSP-2026-000184')!;
const retail = PROJECTS.find((p) => p.buildsuiteProjectId === 'BSP-2026-000212')!;

function allow(project: Project, contact: Contact) {
  const result = toClientProject(project, contact);
  assert.ok(result.allowed, 'expected the gate to allow this projection');
  return result.view;
}

// ── §9.3 — nothing internal, by value or by key ──────────────────────────────

test('§9.3 no internal VALUE from the source record survives projection', () => {
  const view = allow(kitchen, johnson);
  const serialized = JSON.stringify(view);

  // The actual secrets, not just their field names. A rename would slip past a
  // key-only check; a value check would still catch it.
  for (const secret of [
    String(kitchen.originalEstimate),
    String(kitchen.internalMarkup),
    String(kitchen.margin),
    kitchen.internalNotes,
    kitchen.internalPriority,
  ]) {
    assert.ok(
      !serialized.includes(secret),
      `internal value leaked into the client projection: ${secret}`,
    );
  }
});

test('§9.3 no deny-listed field NAME appears in the projection', () => {
  const serialized = JSON.stringify(allow(kitchen, johnson)).toLowerCase();
  for (const field of INTERNAL_FIELD_DENY_LIST) {
    const camel = field
      .split(' ')
      .map((w, i) => (i === 0 ? w.toLowerCase() : w))
      .join('')
      .toLowerCase();
    assert.ok(!serialized.includes(`"${camel}"`), `deny-listed key present: ${camel}`);
  }
});

test('§9.3 a delay reason never reaches the client', () => {
  const delayed = PROJECTS.find((p) => p.delayReason !== '')!;
  const contact = CONTACTS.find((c) => c.projectIds.includes(delayed.buildsuiteProjectId));
  if (contact === undefined) return; // no client on that project in fixtures
  const serialized = JSON.stringify(allow(delayed, contact));
  assert.ok(!serialized.includes(delayed.delayReason));
});

// ── §9.1 — the gate ──────────────────────────────────────────────────────────

test('§9.1 portal disabled denies the whole project', () => {
  const contact: Contact = {
    id: 'c',
    name: 'x',
    email: 'x@example.com',
    projectIds: [retail.buildsuiteProjectId],
  };
  const result = toClientProject(retail, contact);
  assert.equal(result.allowed, false);
  assert.equal(result.allowed === false ? result.reason : '', 'client_portal_disabled');
});

test('§9.1 a contact cannot project a project they are not associated with', () => {
  const result = toClientProject(kitchen, whitfield);
  assert.equal(result.allowed, false);
  assert.equal(result.allowed === false ? result.reason : '', 'contact_not_associated');
});

test('§1.4 a contact with two projects can project both', () => {
  assert.equal(johnson.projectIds.length, 2);
  for (const id of johnson.projectIds) {
    const project = PROJECTS.find((p) => p.buildsuiteProjectId === id)!;
    assert.ok(toClientProject(project, johnson).allowed, id);
  }
});

// ── §6.1 — the per-project switches ──────────────────────────────────────────

test('§6.1 switches off remove budget, team, and completion date', () => {
  const locked: Project = {
    ...kitchen,
    showBudgetToClient: false,
    showDetailedPricing: false,
    showAssignedTeam: false,
    showScheduleToClient: false,
  };
  const view = allow(locked, johnson);
  assert.equal(view.budget, null);
  assert.equal(view.team, null);
  assert.equal(view.estimatedCompletionDate, null);
  // The non-gated fields still come through — this is a filter, not a blackout.
  assert.equal(view.projectName, kitchen.projectName);
  assert.equal(view.progressPercentage, kitchen.progressPercentage);
});

test('§6.1 budget appears only through the allow-list, never the raw record', () => {
  const view = allow(kitchen, johnson);
  assert.ok(view.budget !== null);
  assert.equal(view.budget.contractAmount, kitchen.contractAmount);
  // Every key on the budget object is on the §9.3 allow-list.
  assert.deepEqual(Object.keys(view.budget).sort(), [
    'amountInvoiced',
    'amountPaid',
    'approvedChangeOrders',
    'contractAmount',
    'currentProjectTotal',
    'nextPaymentAmount',
    'nextPaymentDueDate',
    'pendingChangeOrders',
    'remainingBalance',
  ]);
});

// ── §10 — publishing ─────────────────────────────────────────────────────────

test('§10 only Approved & Published updates reach the client', () => {
  const updates = DAILY_UPDATES.filter((u) => u.projectId === kitchen.buildsuiteProjectId);
  const views = toClientUpdates(updates, kitchen);

  const published = updates.filter((u) => u.managerApprovalStatus === 'Approved & Published');
  assert.equal(views.length, published.length);
  assert.ok(published.length > 0, 'fixture should contain at least one published update');

  const serialized = JSON.stringify(views);
  for (const u of updates) {
    assert.ok(!serialized.includes(u.internalNotes), `internal notes leaked from ${u.id}`);
  }
});

test('§10 an Approved Internally update stays internal', () => {
  const internalOnly = DAILY_UPDATES.filter(
    (u) => u.managerApprovalStatus === 'Approved Internally',
  );
  assert.ok(internalOnly.length > 0, 'fixture should cover the internal-approval case');
  for (const u of internalOnly) {
    const project = PROJECTS.find((p) => p.buildsuiteProjectId === u.projectId)!;
    assert.deepEqual(toClientUpdates([u], project), []);
  }
});

test('§10 client updates carry the summary and never the work log', () => {
  const updates = DAILY_UPDATES.filter((u) => u.projectId === kitchen.buildsuiteProjectId);
  for (const view of toClientUpdates(updates, kitchen)) {
    assert.deepEqual(Object.keys(view).sort(), [
      'clientSummary',
      'id',
      'publishDate',
      'updateDate',
    ]);
  }
});

// ── Schedule ─────────────────────────────────────────────────────────────────

test('§6.1 milestones are withheld when Show Schedule to Client is off', () => {
  const milestones = MILESTONES.filter((m) => m.projectId === kitchen.buildsuiteProjectId);
  assert.ok(toClientMilestones(milestones, kitchen).length > 0);
  assert.deepEqual(toClientMilestones(milestones, { ...kitchen, showScheduleToClient: false }), []);
});

test('§6 milestones flagged not-client-visible are dropped individually', () => {
  const milestones = MILESTONES.filter((m) => m.projectId === kitchen.buildsuiteProjectId);
  const hidden = [{ ...milestones[0]!, id: 'ms-hidden', clientVisible: false }];
  const views = toClientMilestones([...milestones, ...hidden], kitchen);
  assert.ok(!views.some((m) => m.id === 'ms-hidden'));
});

// ── Regression guard ─────────────────────────────────────────────────────────

test('every fixture project projects cleanly for its own contact', () => {
  for (const contact of CONTACTS) {
    for (const id of contact.projectIds) {
      const project = PROJECTS.find((p) => p.buildsuiteProjectId === id)!;
      const result = toClientProject(project, contact);
      if (!result.allowed) {
        assert.equal(result.reason, 'client_portal_disabled', `${id}: unexpected denial`);
        continue;
      }
      const serialized = JSON.stringify(result.view);
      assert.ok(!serialized.includes(project.internalNotes), `${id} leaked internal notes`);
      assert.ok(
        !serialized.includes(String(project.originalEstimate)),
        `${id} leaked original estimate`,
      );
    }
  }
});
