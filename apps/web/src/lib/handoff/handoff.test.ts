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

test('the shared key is a decision, and the mapping refuses to pick one', () => {
  // §5 wants BSP-YYYY-NNNNNN. BuildSuite has a UUID id and a BSA-NNN code.
  // Choosing between them here is exactly the mistake the rules warn against.
  const attempt = buildHandoffFromDeal(SIGNED, project());
  assert.equal(attempt.ok, false);

  const key = attempt.gaps.find((g) => g.field === 'buildsuite_project_id');
  assert.ok(key);
  assert.equal(key.owner, 'decision');
  assert.match(key.reason, /BSP-YYYY-NNNNNN/);
  assert.match(key.reason, /C-3/, 'it must point at the open decision, not resolve it');
});

test('a BSA code is refused as loudly as a UUID', () => {
  // 48 of 101 projects carry one, and its shape is close enough to look right.
  const attempt = buildHandoffFromDeal(SIGNED, project({ projectCode: 'BSA-002' }));

  assert.equal(attempt.ok, false);
  assert.ok(attempt.gaps.some((g) => g.field === 'buildsuite_project_id'));
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
  assert.equal(byOwner.decision.length, 1, 'the shared key');
  assert.equal(byOwner.BuildSuite.length, 1, 'the contract amount');
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
