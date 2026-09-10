import assert from 'node:assert/strict';
import test from 'node:test';

import { transition, type PublishingState } from '@buildsuite/contracts';
import { toApprovalStatus, PUBLISHED_APPROVAL_STATUS } from '@buildsuite/contracts';

import { execute } from './executor.ts';
import { planFieldUpdateSubmitted } from './wf3-update-submitted.ts';
import { planFieldUpdateApproved } from './wf4-update-approved.ts';
import { toClientUpdates } from '../client-projection.ts';
import { effectiveCan } from '../permissions.ts';
import type { DailyUpdate, Project } from '../data/types.ts';

/**
 * ONE UPDATE, ALL THE WAY THROUGH: field → PM review → homeowner's screen.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS ALONGSIDE `publishing.test.ts`
 *
 * That file tests the pieces: the transition table, the WF3 plan, the WF4 plan,
 * the executor. Each is correct on its own, and each is checked against §10 and
 * §11 verbatim.
 *
 * What nothing tested was the SEAM — one record carried the whole distance,
 * with the permission matrix consulted at each step and the §9.1 gate run at
 * the end on the same object the field user actually filed. Every real leak in
 * this project has been at a seam rather than inside a piece: a projection that
 * dropped a field the record still carried, a screen that resolved its own
 * projects, a session minted without the tenant.
 *
 * So this walks the record, and asserts at every stage BOTH what moved and what
 * the homeowner can see at that moment. The interesting assertions are the ones
 * about the middle states — the update exists, it is approved, and it is still
 * invisible.
 * ---------------------------------------------------------------------------
 */

const PROJECT: Project = {
  buildsuiteProjectId: 'BSA-052',
  clientPortalEnabled: true,
  showScheduleToClient: true,
} as unknown as Project;

/** What a field user actually files at the end of a day on site. */
function fieldSubmission(): DailyUpdate {
  return {
    id: 'du-1',
    projectId: 'BSA-052',
    updateDate: '2026-09-10',
    submittedBy: 'Marco (superintendent)',
    workCompleted: 'Framed the north wall, set the header over the kitchen opening.',
    crewOnsite: 4,
    hoursWorked: 32,
    weather: 'Clear, 71F',
    // §9.3. The field user writes this expecting their PM to read it, and
    // nobody else. It is the tracer through the whole test.
    internalNotes:
      'Ran 3 hours long, will eat into Thursday. Client asked about the tile budget again — do NOT quote them a number.',
    clientSummary: '',
    clientVisible: false,
    managerApprovalStatus: 'Pending',
    publishDate: null,
  };
}

/** Everything the homeowner's Updates screen would receive, right now. */
function whatTheClientSees(update: DailyUpdate) {
  return toClientUpdates([update], PROJECT);
}

class Ports {
  readonly fired: { type: string; payload: Record<string, unknown> }[] = [];
  readonly handlers = new Proxy(
    {},
    {
      get: (_t, type: string) => async (payload: Record<string, unknown>) => {
        this.fired.push({ type, payload });
      },
    },
  ) as never;

  ofType(type: string) {
    return this.fired.filter((e) => e.type === type);
  }

  reset() {
    this.fired.length = 0;
  }
}

// ── The journey ──────────────────────────────────────────────────────────────

test('the whole journey: a field update reaches a homeowner only by the long road', async () => {
  const ports = new Ports();
  const update = fieldSubmission();
  let state: PublishingState = 'DRAFT';

  // ── 1 · The field user files it ────────────────────────────────────────────

  assert.equal(effectiveCan('field', 'create', 'dailyUpdate'), true, 'a field user files updates');
  assert.equal(
    effectiveCan('field', 'publish', 'dailyUpdate'),
    false,
    'D4 §5 — a field user may never publish',
  );

  const submit = transition(state, 'SUBMIT_TO_PM', 'field');
  assert.equal(submit.ok, true);
  state = submit.ok ? submit.to : state;
  assert.equal(state, 'PENDING');
  update.managerApprovalStatus = toApprovalStatus(state)!;

  const wf3 = await execute(
    planFieldUpdateSubmitted({
      updateId: update.id,
      projectId: update.projectId,
      submittedBy: update.submittedBy,
      blocker: '',
      clientDecisionNeeded: false,
    } as never),
    ports.handlers,
  );
  assert.equal(wf3.status, 'ok');
  assert.equal(ports.ofType('NotifyClient').length, 0, '§3.2 — the loop stops at the PM');

  // THE CLIENT SEES NOTHING. The update exists and is filed correctly.
  assert.deepEqual(whatTheClientSees(update), []);

  // ── 2 · The field user cannot shortcut ─────────────────────────────────────

  assert.equal(
    transition(state, 'APPROVE_AND_PUBLISH', 'field').ok,
    false,
    '§3.2 — there is no field actor on any approval edge',
  );
  assert.equal(
    transition('DRAFT', 'APPROVE_AND_PUBLISH', 'pm').ok,
    false,
    '§10 — there is no DRAFT → PUBLISHED edge for anyone',
  );

  // ── 3 · The PM returns it, and the field user resubmits ────────────────────

  const returned = transition(state, 'RETURN_FOR_REVISION', 'pm');
  assert.equal(returned.ok, true);
  state = returned.ok ? returned.to : state;
  assert.equal(state, 'RETURNED');
  update.managerApprovalStatus = toApprovalStatus(state)!;
  assert.deepEqual(whatTheClientSees(update), [], 'a returned update is not a published one');

  const resubmit = transition(state, 'SUBMIT_TO_PM', 'field');
  assert.equal(resubmit.ok, true);
  state = resubmit.ok ? resubmit.to : state;
  update.managerApprovalStatus = toApprovalStatus(state)!;

  // ── 4 · The PM approves INTERNALLY — the state that catches people out ─────

  const internally = transition(state, 'APPROVE_INTERNALLY', 'pm');
  assert.equal(internally.ok, true);
  state = internally.ok ? internally.to : state;
  assert.equal(state, 'APPROVED_INTERNALLY');
  update.managerApprovalStatus = toApprovalStatus(state)!;
  assert.equal(update.managerApprovalStatus, 'Approved Internally');

  ports.reset();
  const wf4Internal = await execute(
    planFieldUpdateApproved({
      updateId: update.id,
      projectId: update.projectId,
      managerApprovalStatus: update.managerApprovalStatus,
      clientSummary: 'North wall framed.',
      clientPortalEnabled: true,
      notifyClient: true,
      contactId: 'ghl-1',
    } as never),
    ports.handlers,
  );

  // §10, the invariant most likely to be broken: approved is not published.
  assert.equal(wf4Internal.status, 'skipped', 'WF4 must not fire on Approved Internally');
  assert.equal(ports.ofType('NotifyClient').length, 0);
  assert.deepEqual(whatTheClientSees(update), [], 'APPROVED ≠ VISIBLE');

  // ── 5 · The PM writes the client summary ───────────────────────────────────

  assert.equal(effectiveCan('contractor', 'publish', 'dailyUpdate'), true);

  const editing = transition(state, 'EDIT_CLIENT_SUMMARY', 'pm');
  assert.equal(editing.ok, true, 'a PM may rewrite the summary while it is approved internally');
  assert.equal(editing.ok && editing.to, 'APPROVED_INTERNALLY', 'editing does not advance it');

  // Note what the PM writes, against what the field user wrote. The summary is
  // composed for the homeowner; it is not the field notes with a filter on.
  update.clientSummary = 'Framing continued on the north wall. On track for inspection Friday.';

  // ── 6 · Publication ────────────────────────────────────────────────────────

  const publish = transition(state, 'APPROVE_AND_PUBLISH', 'pm');
  assert.equal(publish.ok, true);
  state = publish.ok ? publish.to : state;
  assert.equal(state, 'APPROVED_AND_PUBLISHED');
  update.managerApprovalStatus = toApprovalStatus(state)!;
  assert.equal(update.managerApprovalStatus, PUBLISHED_APPROVAL_STATUS);
  update.clientVisible = true;
  update.publishDate = '2026-09-10';

  ports.reset();
  const wf4 = await execute(
    planFieldUpdateApproved({
      updateId: update.id,
      projectId: update.projectId,
      managerApprovalStatus: update.managerApprovalStatus,
      clientSummary: update.clientSummary,
      clientPortalEnabled: true,
      notifyClient: true,
      contactId: 'ghl-1',
    } as never),
    ports.handlers,
  );
  assert.equal(wf4.status, 'ok');
  assert.equal(ports.ofType('NotifyClient').length, 1, 'now, and only now, the homeowner hears');

  // ── 7 · What the homeowner actually receives ───────────────────────────────

  const seen = whatTheClientSees(update);
  assert.equal(seen.length, 1, 'the published update finally arrives');

  const view = seen[0]!;
  assert.equal(view.clientSummary, 'Framing continued on the north wall. On track for inspection Friday.');
  assert.equal(view.updateDate, '2026-09-10');
  assert.equal(view.publishDate, '2026-09-10');

  // THE FIELD USER'S NOTES, BY VALUE. `assertNoInternalFields` checks names;
  // this checks that no property anywhere in the payload CONTAINS the text —
  // which is what a leak actually looks like when someone pastes notes into a
  // summary or a projection copies the wrong field.
  const serialized = JSON.stringify(view);
  for (const secret of ['Ran 3 hours long', 'tile budget', 'do NOT quote']) {
    assert.equal(serialized.includes(secret), false, `internal notes leaked: ${secret}`);
  }
  // And the field user's own name, §9.4 — who was on site is an employee record.
  assert.equal(serialized.includes('Marco'), false, 'the crew member’s name reached the client');

  // The projection is built BY LITERAL, so the internal keys are absent rather
  // than present-and-blank. Present-and-blank is what a `delete` leaves behind,
  // and it tells a reader the field exists.
  for (const key of ['internalNotes', 'workCompleted', 'crewOnsite', 'hoursWorked', 'submittedBy', 'weather']) {
    assert.equal(key in view, false, `${key} is present on the client view`);
  }
  assert.deepEqual(
    Object.keys(view).sort(),
    ['clientSummary', 'id', 'publishDate', 'updateDate'],
    'the client view has grown a field — check it against §9.3 before allowing it',
  );
});

// ── The two switches that override a completed journey ───────────────────────

test('a published update disappears when the portal master switch is off', async () => {
  // §9.1 clause 1. A contractor turning the portal off mid-project must take
  // back everything at once, not leave already-published items showing.
  const update = fieldSubmission();
  update.managerApprovalStatus = PUBLISHED_APPROVAL_STATUS;
  update.clientVisible = true;
  update.clientSummary = 'Framing continued.';

  assert.equal(whatTheClientSees(update).length, 1);

  const closed = { ...PROJECT, clientPortalEnabled: false } as Project;
  assert.deepEqual(toClientUpdates([update], closed), []);
});

test('a published update belonging to another project never crosses over', async () => {
  // §9.1 clause 4. The gate checks association, so a correctly published update
  // still cannot appear under a project it does not belong to.
  const update = fieldSubmission();
  update.projectId = 'BSA-999';
  update.managerApprovalStatus = PUBLISHED_APPROVAL_STATUS;
  update.clientVisible = true;
  update.clientSummary = 'Framing continued.';

  assert.deepEqual(whatTheClientSees(update), []);
});

test('every state before publication shows the homeowner nothing', () => {
  // The table, walked exhaustively rather than sampled. `Approved Internally`
  // is the one that reads like success and is not.
  const update = fieldSubmission();
  update.clientSummary = 'Framing continued.';

  for (const status of ['Pending', 'Returned', 'Approved Internally'] as const) {
    update.managerApprovalStatus = status;
    // Even with the row flag wrongly set — belt and braces, because the flag is
    // a column a person can edit and the approval status is the rule.
    update.clientVisible = true;
    assert.deepEqual(whatTheClientSees(update), [], `${status} reached the client`);
  }
});

test('publication without a client summary publishes nothing to read', () => {
  // WF4 refuses an empty summary, and the gate would otherwise pass an update
  // whose only client-facing field is blank — a feed entry that says nothing,
  // which reads as a fault rather than as silence.
  const update = fieldSubmission();
  update.managerApprovalStatus = PUBLISHED_APPROVAL_STATUS;
  update.clientVisible = true;
  update.clientSummary = '';

  const seen = whatTheClientSees(update);
  assert.equal(seen.length, 1, 'the gate itself does not check the summary — WF4 does');
  assert.equal(seen[0]!.clientSummary, '');
});
