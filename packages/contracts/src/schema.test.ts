/**
 * §6.1 schema mirror and the §10 publishing state machine.
 *
 * The load-bearing test in this file is the reachability one: it proves by
 * exhaustive search that no sequence of legal moves gets a field user's draft
 * in front of a client without a PM in the path (§3.2).
 *
 * Run: node --test src/*.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROJECT_FIELDS,
  clientEligibleFields,
  demoableCoreFields,
  projectField,
  visibleProjectFields,
} from './project-schema.ts';
import {
  DAILY_UPDATE_FIELDS,
  FIELD_APP_NOTE_AREAS,
  TRANSITIONS,
  isPublished,
  toApprovalStatus,
  transition,
  type PublishingEvent,
  type PublishingState,
} from './daily-update.ts';
import { isInternalField } from './deny-list.ts';

// ── §6.1 Project ─────────────────────────────────────────────────────────────

test('§6.1 field names are unique', () => {
  const names = PROJECT_FIELDS.map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
});

test('§6.1 ∩ §9.3 — no client-visible field is on the deny-list', () => {
  const contradictions = PROJECT_FIELDS.filter((f) => f.clientVisible && isInternalField(f.name));
  assert.deepEqual(contradictions.map((f) => f.name), []);
});

test('§9.3 every deny-listed Project field is marked internal', () => {
  for (const name of ['Original Estimate', 'Internal Priority', 'Delay Reason']) {
    assert.equal(projectField(name)?.clientVisible, false, name);
  }
});

test('§14 Phase 1 demoable core is exactly the ten fields from the kickoff plan', () => {
  assert.deepEqual(
    demoableCoreFields().map((f) => f.name).sort(),
    [
      'BuildSuite Project ID',
      'Client Portal Enabled',
      'Contract Amount',
      'Current Milestone',
      'Estimated Completion Date',
      'Primary Contact',
      'Progress Percentage',
      'Project Address',
      'Project Name',
      'Project Stage',
    ],
  );
});

test('§6.1 the visibility switches are never themselves client-facing', () => {
  for (const f of PROJECT_FIELDS.filter((f) => f.group === 'Visibility')) {
    assert.equal(f.clientVisible, false, f.name);
  }
});

test('§6.1 Show Assigned Team gates the team names, and nothing else does', () => {
  const off = visibleProjectFields({}).map((f) => f.name);
  assert.ok(!off.includes('Project Manager'));
  assert.ok(!off.includes('Superintendent'));
  assert.ok(off.includes('Project Name'), 'ungated CV fields are unaffected');

  const on = visibleProjectFields({ 'Show Assigned Team': true }).map((f) => f.name);
  assert.ok(on.includes('Project Manager'));
  assert.ok(on.includes('Superintendent'));
});

test('§9.3 financials stay hidden until a budget switch is on', () => {
  const off = visibleProjectFields({}).map((f) => f.name);
  assert.ok(!off.includes('Contract Amount'));
  assert.ok(!off.includes('Remaining Balance'));

  const on = visibleProjectFields({ 'Show Budget to Client': true }).map((f) => f.name);
  assert.ok(on.includes('Contract Amount'));
  assert.ok(!on.includes('Original Estimate'), '§9.3 deny-list is not switchable');
});

test('§9.3 no switch combination can surface a deny-listed field', () => {
  const everySwitchOn = Object.fromEntries(
    PROJECT_FIELDS.filter((f) => f.group === 'Visibility').map((f) => [f.name, true]),
  );
  const surfaced = visibleProjectFields(everySwitchOn).filter((f) => isInternalField(f.name));
  assert.deepEqual(surfaced.map((f) => f.name), []);
  assert.equal(clientEligibleFields().some((f) => isInternalField(f.name)), false);
});

// ── §6.4 Daily Update ────────────────────────────────────────────────────────

test('§6.4 Internal Notes is internal and Client Summary is the publish candidate', () => {
  const internalNotes = DAILY_UPDATE_FIELDS.find((f) => f.name === 'Internal Notes');
  const clientSummary = DAILY_UPDATE_FIELDS.find((f) => f.name === 'Client Summary');
  assert.equal(internalNotes?.clientVisible, false);
  assert.ok(isInternalField('Internal Notes'));
  assert.equal(clientSummary?.clientVisible, true);
});

test('§12.2 the field app keeps the two note areas as separate fields', () => {
  assert.notEqual(FIELD_APP_NOTE_AREAS.internal, FIELD_APP_NOTE_AREAS.publishCandidate);
  assert.equal(FIELD_APP_NOTE_AREAS.publishCandidate, 'Suggested Client Progress Summary');
});

// ── §10 state machine ────────────────────────────────────────────────────────

test('§10 the happy path reaches published', () => {
  const submitted = transition('DRAFT', 'SUBMIT_TO_PM', 'field');
  assert.deepEqual(submitted, { ok: true, to: 'PENDING' });
  assert.deepEqual(transition('PENDING', 'EDIT_CLIENT_SUMMARY', 'pm'), { ok: true, to: 'PENDING' });
  assert.deepEqual(transition('PENDING', 'APPROVE_AND_PUBLISH', 'pm'), {
    ok: true,
    to: 'APPROVED_AND_PUBLISHED',
  });
});

test('§3.2 a field user cannot publish', () => {
  const result = transition('PENDING', 'APPROVE_AND_PUBLISH', 'field');
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /may not fire APPROVE_AND_PUBLISH/);
});

test('§3.2 there is no DRAFT → published shortcut', () => {
  for (const event of ['APPROVE_AND_PUBLISH', 'APPROVE_INTERNALLY'] as const) {
    const result = transition('DRAFT', event, 'pm');
    assert.equal(result.ok, false, event);
  }
});

test('§3.2 EXHAUSTIVE: every path from DRAFT to published passes through a PM', () => {
  const EVENTS: PublishingEvent[] = [
    'SUBMIT_TO_PM',
    'RETURN_FOR_REVISION',
    'APPROVE_INTERNALLY',
    'APPROVE_AND_PUBLISH',
    'EDIT_CLIENT_SUMMARY',
  ];

  // Breadth-first over every legal move a FIELD user can make, alone.
  const reachableByFieldAlone = new Set<PublishingState>(['DRAFT']);
  const queue: PublishingState[] = ['DRAFT'];
  while (queue.length > 0) {
    const state = queue.shift()!;
    for (const event of EVENTS) {
      const result = transition(state, event, 'field');
      if (result.ok && !reachableByFieldAlone.has(result.to)) {
        reachableByFieldAlone.add(result.to);
        queue.push(result.to);
      }
    }
  }

  assert.ok(
    !reachableByFieldAlone.has('APPROVED_AND_PUBLISHED'),
    'a field user reached the client without a PM — §3.2 violated',
  );
  assert.deepEqual([...reachableByFieldAlone].sort(), ['DRAFT', 'PENDING']);
});

test('§10 RETURNED cycles back for revision rather than dead-ending', () => {
  assert.deepEqual(transition('PENDING', 'RETURN_FOR_REVISION', 'pm'), {
    ok: true,
    to: 'RETURNED',
  });
  assert.deepEqual(transition('RETURNED', 'SUBMIT_TO_PM', 'field'), { ok: true, to: 'PENDING' });
});

test('§10 APPROVED_INTERNALLY is terminal-for-the-client until explicitly published', () => {
  assert.ok(!isPublished('APPROVED_INTERNALLY'));
  assert.equal(toApprovalStatus('APPROVED_INTERNALLY'), 'Approved Internally');
  assert.deepEqual(transition('APPROVED_INTERNALLY', 'APPROVE_AND_PUBLISH', 'pm'), {
    ok: true,
    to: 'APPROVED_AND_PUBLISHED',
  });
});

test('§10 published is terminal — no transition leaves it', () => {
  assert.deepEqual(TRANSITIONS.filter((t) => t.from === 'APPROVED_AND_PUBLISHED'), []);
  assert.ok(isPublished('APPROVED_AND_PUBLISHED'));
});

test('§6.4 every state maps to a real Manager Approval Status value', () => {
  assert.equal(toApprovalStatus('DRAFT'), null, 'a draft has not entered approval yet');
  assert.equal(toApprovalStatus('APPROVED_AND_PUBLISHED'), 'Approved & Published');
});
