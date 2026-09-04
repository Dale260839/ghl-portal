/**
 * The handoff path — the mapping, and the rehearsal of the whole chain.
 *
 * Built before a signed deal exists, which is the point: nothing has ever been
 * signed (0 of 182), so the first real signature would otherwise be spent
 * debugging. These tests pin what must arrive and what happens when it does.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDeal, type BuildSuiteDealRow, type Deal } from '../buildsuite/deals.ts';
import { routeWebhook } from '../ghl/webhook-routing.ts';
import type { WebhookEvent } from '../ghl/webhook.ts';
import { buildHandoffFromDeal, gapsByOwner, type HandoffProjectFacts } from './from-deal.ts';
import { rehearseHandoff } from './rehearsal.ts';

function deal(over: Partial<BuildSuiteDealRow> = {}): Deal {
  return normalizeDeal({
    id: 'deal-1',
    status: 'proposal_sent',
    source: 'ghl_project_quote_survey',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    auth_profile_id: 'profile-a',
    source_project_id: '80ef9efa-62b5-4d54-9ac3-d7940ea42e87',
    matched_contractor_id: 'contractor-1',
    sent_to_crm_at: null,
    signature_status: 'SENT',
    signature_signed_at: null,
    client_name: 'Chris Carr',
    project_type: 'kitchen',
    budget_range: '50k_100k',
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    coverage_score: 0.9,
    ...over,
  });
}

const SIGNED = deal({ signature_signed_at: '2026-08-20T09:00:00Z' });

/** The real shape, measured: a UUID id, no project_code, no exact_budget. */
function project(over: Partial<HandoffProjectFacts> = {}): HandoffProjectFacts {
  return {
    id: '80ef9efa-62b5-4d54-9ac3-d7940ea42e87',
    projectCode: null,
    title: 'Kitchen remodel',
    address: '1 Example St, Bellevue, WA',
    clientName: 'Chris Carr',
    clientEmail: 'chris@example.com',
    clientPhone: '555-0100',
    contractAmount: null,
    ...over,
  };
}

/** Every gap closed — what BuildSuite must send for the chain to run. */
const COMPLETE = project({
  projectCode: 'BSP-2026-000184',
  contractAmount: 82_500,
});

// ── The mapping ──────────────────────────────────────────────────────────────

test('the real project shape cannot satisfy the §8.2 contract', () => {
  // Measured 2026-08-28. This is the finding, encoded: if BuildSuite sent the
  // handoff today with the columns it has, it would be rejected.
  const attempt = buildHandoffFromDeal(SIGNED, project());
  assert.equal(attempt.ok, false);

  const fields = attempt.gaps.map((g) => g.field).sort();
  assert.deepEqual(fields, ['buildsuite_project_id', 'contract_amount']);
});

// These two tests previously asserted the opposite — that a BSA code was
// refused and that the mapping must NOT choose a key, because C-3 was open.
// Chris resolved C-3 on 2026-09-01: the key is `projects.project_code`. The
// rule they encode has changed at the source, so they now encode the new one.

test('a project with no code is a BuildSuite gap, not a decision', () => {
  // 53 of 102 projects have no code. That is missing data with an owner, not
  // an open question — the handoff cannot fire, and BuildSuite has to fill it.
  const attempt = buildHandoffFromDeal(SIGNED, project());
  assert.equal(attempt.ok, false);

  const key = attempt.gaps.find((g) => g.field === 'buildsuite_project_id');
  assert.ok(key);
  assert.equal(key.owner, 'BuildSuite', 'C-3 is resolved; this is no longer a decision');
  assert.match(key.reason, /project_code/);
});

test('a BSA code is now the join key and passes', () => {
  // Still not `ok` overall — this fixture has no contract amount — but the KEY
  // is no longer among the reasons why.
  const attempt = buildHandoffFromDeal(SIGNED, project({ projectCode: 'BSA-002' }));
  assert.equal(attempt.ok, false);

  assert.equal(
    attempt.gaps.some((g) => g.field === 'buildsuite_project_id'),
    false,
    'BSA-NNN is the format C-3 settled on',
  );
  assert.equal(attempt.partial.buildsuite_project_id, 'BSA-002');
});

test('a UUID is never substituted for a missing code', () => {
  // The old mapping fell back to `projects.id`. A UUID is not the join key,
  // and sending one would attach records by a key GHL is not given.
  const attempt = buildHandoffFromDeal(SIGNED, project({ projectCode: null }));
  assert.equal(attempt.ok, false);

  assert.equal(attempt.partial.buildsuite_project_id, undefined, 'absent, not a UUID');
  assert.equal(
    JSON.stringify(attempt.partial).includes('80ef9efa'),
    false,
    'the UUID leaked into the payload',
  );
});

test('a malformed code is refused rather than passed through', () => {
  const attempt = buildHandoffFromDeal(SIGNED, project({ projectCode: 'BSA-2' }));
  assert.equal(attempt.ok, false);

  const key = attempt.gaps.find((g) => g.field === 'buildsuite_project_id');
  assert.ok(key, 'a code that only looks right is worse than a missing one');
  assert.match(key.reason, /not a recognised project key/i);
});

test('a budget band is not a contract amount', () => {
  const attempt = buildHandoffFromDeal(SIGNED, project());
  assert.equal(attempt.ok, false);

  const money = attempt.gaps.find((g) => g.field === 'contract_amount');
  assert.ok(money);
  assert.equal(money.owner, 'BuildSuite');
  assert.match(money.reason, /50k_100k/, 'the band it had should be quoted back');
});

test('missing client contact details are reported, not silently blanked', () => {
  const attempt = buildHandoffFromDeal(
    SIGNED,
    project({ projectCode: 'BSP-2026-000184', contractAmount: 1000, clientEmail: null, clientPhone: '  ' }),
  );

  assert.equal(attempt.ok, false);
  assert.deepEqual(
    attempt.gaps.map((g) => g.field).sort(),
    ['client.email', 'client.phone'],
  );
});

test('with every gap closed the payload validates', () => {
  const attempt = buildHandoffFromDeal(SIGNED, COMPLETE);

  assert.equal(attempt.ok, true);
  assert.equal(attempt.payload.buildsuite_project_id, 'BSP-2026-000184');
  assert.equal(attempt.payload.contract_amount, 82_500);
  assert.equal(attempt.payload.client.name, 'Chris Carr');
});

test('the gaps are grouped by who has to act', () => {
  const attempt = buildHandoffFromDeal(SIGNED, project());
  assert.equal(attempt.ok, false);

  const byOwner = gapsByOwner(attempt.gaps);
  // Both gaps are BuildSuite's now: the missing project_code and the missing
  // contract amount. Nothing is left waiting on a decision at this boundary.
  assert.equal(byOwner.decision.length, 0, 'C-3 was the only decision gap here');
  assert.equal(byOwner.BuildSuite.length, 2, 'the project code and the contract amount');
});

test('a failed mapping still returns what it could build', () => {
  // So the ask can quote the values rather than describing them.
  const attempt = buildHandoffFromDeal(SIGNED, project());

  assert.equal(attempt.ok, false);
  assert.equal(attempt.partial.project_name, 'Kitchen remodel');
  assert.equal(attempt.partial.contract_amount, undefined, 'absent, not zero');
});

// ── The route ────────────────────────────────────────────────────────────────

function event(type: string, locationId: string | null = 'loc-1'): WebhookEvent {
  return { id: 'evt-1', type, locationId, raw: {} };
}

test('the handoff event now reaches WF1', () => {
  // Before today WF1 had no trigger at all — it was the one workflow no webhook
  // could start, so a signed deal would have arrived and done nothing.
  for (const type of [
    'ProjectHandoffReceived',
    'project.created',
    'EstimateApproved',
    'opportunity_estimate_approved',
  ]) {
    const routing = routeWebhook(event(type));
    assert.equal(routing.handled, true, `${type} did not route`);
    assert.equal(routing.workflow, 'WF1', `${type} routed to the wrong workflow`);
  }
});

test('a handoff event with no location is refused rather than guessed', () => {
  const routing = routeWebhook(event('ProjectHandoffReceived', null));

  assert.equal(routing.handled, false);
  assert.match(routing.why, /locationId/);
});

test('adding WF1 did not capture the other workflows', () => {
  const workflowFor = (type: string) => {
    const routing = routeWebhook(event(type));
    return routing.handled ? routing.workflow : null;
  };

  assert.equal(workflowFor('OpportunityStageChange'), 'WF2');
  assert.equal(workflowFor('ProjectCompleted'), 'WF8');
});

// ── The rehearsal ────────────────────────────────────────────────────────────

test('today the chain stops at step 1, because nothing is signed', () => {
  const result = rehearseHandoff({ deal: deal(), project: project() });

  assert.equal(result.hubChainComplete, false);
  assert.equal(result.blockedAt?.step, 1);
  assert.equal(result.blockedAt?.owner, 'BuildSuite');
  assert.match(result.blockedAt?.detail ?? '', /0 of 182/);
});

test('signed but unmapped, it stops at step 2 and names the fields', () => {
  const result = rehearseHandoff({ deal: SIGNED, project: project() });

  assert.equal(result.hubChainComplete, false);
  assert.equal(result.blockedAt?.step, 2);
  assert.match(result.blockedAt?.detail ?? '', /buildsuite_project_id/);
  assert.match(result.blockedAt?.detail ?? '', /contract_amount/);
});

test('with the gaps closed the Hub half runs to completion', () => {
  const result = rehearseHandoff({
    deal: SIGNED,
    project: COMPLETE,
    projectManagerUserId: 'user-pm-1',
  });

  assert.equal(result.hubChainComplete, true);
  assert.equal(result.blockedAt, null);

  // 7 milestones + 2 tasks + create/associate x3 + PM + progress + notify +
  // portal + activity. Pinned so a change to WF1's seeding is deliberate.
  assert.equal(result.effects.length, 17);
  const byType = Object.fromEntries(result.effectSummary.map((e) => [e.type, e.count]));
  assert.equal(byType.CreateProject, 1);
  assert.equal(byType.CreateMilestone, 7);
  assert.equal(byType.CreateTask, 2);
  assert.equal(byType.PrepareClientPortalAccess, 1);
});

test('the rehearsal is honest about which steps are not ours', () => {
  const result = rehearseHandoff({ deal: SIGNED, project: COMPLETE });

  const ours = result.stages.filter((s) => s.owner === 'Hub');
  const theirs = result.stages.filter((s) => s.owner !== 'Hub');
  assert.equal(ours.length, 2, 'routing and planning');
  assert.equal(theirs.length, 3, 'signature, send-to-crm, GHL');
  assert.ok(
    theirs.every((s) => s.status === 'not-ours'),
    'a step we do not perform must never report as ok',
  );
});

test('a second delivery of the same handoff does not duplicate the seeding', () => {
  // The handoff can legitimately fire twice — a resent proposal, a retried
  // webhook. Idempotence is why WF1 has that branch.
  const result = rehearseHandoff({ deal: SIGNED, project: COMPLETE, projectExists: true });

  assert.equal(result.hubChainComplete, true);
  assert.equal(result.effects.length, 1);
  assert.equal(result.effects[0].type, 'RecordActivity');
});

test('an unmapped event stops at routing rather than reaching the planner', () => {
  const result = rehearseHandoff({
    deal: SIGNED,
    project: COMPLETE,
    eventType: 'SomethingGhlInvented',
  });

  assert.equal(result.hubChainComplete, false);
  assert.equal(result.blockedAt?.step, 4);
  assert.deepEqual(result.effects, []);
});

test('the rehearsal touches nothing — it is pure', () => {
  // A rehearsal that wrote to a live system would be worse than none. Running
  // it twice must produce identical output, which a clock or a network call
  // would break.
  const a = rehearseHandoff({ deal: SIGNED, project: COMPLETE });
  const b = rehearseHandoff({ deal: SIGNED, project: COMPLETE });

  assert.deepEqual(a, b);
});
