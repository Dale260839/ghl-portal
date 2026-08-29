/**
 * The whole loop, end to end.
 *
 * This is the sequence the product is for — signed deal, project, field update,
 * PM publishes, homeowner sees it — and it has never run on real data because
 * nothing has ever been signed. These tests are the only place it runs at all.
 *
 * The ones that matter most are the **negatives**. A rehearsal that only proves
 * the happy path proves the plumbing, not the product.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDeal, type BuildSuiteDealRow, type Deal } from '../buildsuite/deals.ts';
import type { HandoffProjectFacts } from './from-deal.ts';
import { rehearseFullChain, formatFullChain } from './full-chain.ts';

function signedDeal(over: Partial<BuildSuiteDealRow> = {}): Deal {
  return normalizeDeal({
    id: 'deal-1',
    status: 'proposal_sent',
    source: 'ghl_project_quote_survey',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-08-20T10:00:00Z',
    auth_profile_id: 'profile-a',
    source_project_id: 'project-1',
    matched_contractor_id: 'contractor-1',
    sent_to_crm_at: null,
    signature_status: 'SIGNED',
    signature_signed_at: '2026-08-20T09:00:00Z',
    client_name: 'Chris Carr',
    project_type: 'kitchen',
    budget_range: '50k_100k',
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    coverage_score: 0.9,
    ...over,
  });
}

/** Every handoff gap closed — the state the chain needs to run at all. */
const PROJECT: HandoffProjectFacts = {
  id: 'project-1',
  projectCode: 'BSP-2026-000184',
  title: 'Kitchen remodel',
  address: '1 Example St, Bellevue, WA',
  clientName: 'Chris Carr',
  clientEmail: 'chris@example.com',
  clientPhone: '555-0100',
  contractAmount: 82_500,
};

const READY = {
  deal: signedDeal(),
  project: PROJECT,
  projectManagerUserId: 'user-pm-1',
};

// ── The loop runs ────────────────────────────────────────────────────────────

test('the whole loop completes on synthetic data', () => {
  const result = rehearseFullChain(READY);

  assert.equal(result.complete, true);
  assert.equal(result.blockedAt, null);
  assert.equal(result.stages.length, 9, 'signature through to the homeowner seeing it');
});

test('every workflow in the loop plans effects', () => {
  const result = rehearseFullChain(READY);

  assert.deepEqual(
    result.byWorkflow.map((w) => w.workflow),
    ['WF1 New Project Setup', 'WF3 Field Update Submitted', 'WF4 Field Update Approved'],
  );
  for (const { workflow, effects } of result.byWorkflow) {
    assert.ok(effects.length > 0, `${workflow} planned nothing`);
  }
});

test('the steps the Hub does not own never report ok', () => {
  const result = rehearseFullChain(READY);

  const theirs = result.stages.filter((s) => s.owner !== 'Hub');
  assert.equal(theirs.length, 3, 'signature, send-to-crm, GHL');
  assert.ok(
    theirs.every((s) => s.status === 'not-ours'),
    'claiming a step we do not perform is how a rehearsal starts lying',
  );
});

// ── The negatives, which are the point ───────────────────────────────────────

test('an internally-approved update is hidden and a published one is not', () => {
  // §10 keeps Client Visible = No at "Approved Internally". This is the
  // invariant most likely to break quietly, because both statuses read as
  // approval in English.
  const result = rehearseFullChain(READY);

  assert.equal(result.privacy.internalApprovalHidden, true);
  assert.equal(result.privacy.publishedApprovalVisible, true);
});

test('a homeowner associated with another project is refused', () => {
  // §1.4 — a contact may have many projects, and must not therefore see all of
  // them. The gate keys on association, not on being signed in.
  const result = rehearseFullChain(READY);

  assert.equal(result.privacy.unassociatedContactRefused, true);
});

test('the chain reports broken if the privacy negative ever stops holding', () => {
  // A guard on the guard. Turning the portal master switch off must make the
  // published check fail, which must make `complete` false — proving that the
  // privacy block is actually load-bearing rather than decorative.
  const result = rehearseFullChain({ ...READY, clientPortalEnabled: false });

  assert.equal(result.privacy.publishedApprovalVisible, false, '§6.1 must block it');
  assert.equal(result.complete, false, 'a failed privacy check must fail the chain');
  assert.equal(result.blockedAt?.step, 9);
});

// ── It stops where the real world stops ──────────────────────────────────────

test('an unsigned deal never reaches the field-update half at all', () => {
  const result = rehearseFullChain({ ...READY, deal: signedDeal({ signature_signed_at: null }) });

  assert.equal(result.complete, false);
  assert.equal(result.blockedAt?.step, 1);
  assert.deepEqual(result.byWorkflow, [], 'nothing downstream may plan anything');
});

test('a handoff that cannot be assembled stops before any workflow runs', () => {
  const result = rehearseFullChain({
    ...READY,
    project: { ...PROJECT, projectCode: null, contractAmount: null },
  });

  assert.equal(result.complete, false);
  assert.equal(result.blockedAt?.step, 2);
  assert.deepEqual(result.byWorkflow, []);
});

test('the privacy flags stay false when the chain never got that far', () => {
  // They must not read as "passed" simply because nothing checked them.
  const result = rehearseFullChain({ ...READY, deal: signedDeal({ signature_signed_at: null }) });

  assert.deepEqual(result.privacy, {
    internalApprovalHidden: false,
    publishedApprovalVisible: false,
    unassociatedContactRefused: false,
  });
});

// ── Reporting ────────────────────────────────────────────────────────────────

test('the report states each privacy check as pass or FAIL', () => {
  const text = formatFullChain(rehearseFullChain(READY));

  assert.match(text, /pass {2}"Approved Internally" is hidden/);
  assert.match(text, /pass {2}"Approved & Published" reaches the client/);
  assert.match(text, /pass {2}a contact on another project is refused/);
  assert.doesNotMatch(text, /FAIL/);
});

test('a broken chain says FAIL in the report rather than reading as fine', () => {
  const text = formatFullChain(rehearseFullChain({ ...READY, clientPortalEnabled: false }));

  assert.match(text, /FAIL {2}"Approved & Published" reaches the client/);
});

test('the rehearsal is pure — two runs are identical', () => {
  assert.deepEqual(rehearseFullChain(READY), rehearseFullChain(READY));
});
