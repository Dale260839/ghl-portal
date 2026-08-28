/**
 * The handoff chain, replayed on synthetic data.
 *
 * The point of these tests is not that the code runs. It is that the chain
 * **stops in the right place today** and **completes once the missing pieces
 * arrive** — so when the first real deal is signed, the failure (if any) is one
 * we already named rather than a surprise.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIELDS_DEAL_CANNOT_SUPPLY,
  describeReplay,
  handoffFromDeal,
  replaySignedDeal,
  type ReplayResult,
} from './replay.ts';
import type { Effect } from '../workflows/effects.ts';
import { SHARED_KEY, SHARED_KEY_CONFIRMED, SHARED_KEY_FIELD, sharedKeyStatus } from './shared-key.ts';
import type { Deal } from '../buildsuite/deals.ts';
import { routeWebhook, mappedEventTypes } from '../ghl/webhook-routing.ts';

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: 'deal-1',
    stage: 'draft_ready',
    source: 'intake',
    clientName: 'Dana Johnson',
    projectType: 'Kitchen Remodel',
    budgetRange: '50k-75k',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
    matched: false,
    sentToCrm: false,
    signed: false,
    signatureStatus: '',
    projectId: null,
    ghlContactId: null,
    ghlOpportunityId: null,
    ...over,
  } as Deal;
}

/** Everything BuildSuite has to send that a deal row does not carry. */
const SUPPLIED = {
  sharedKey: 'BSP-2026-000184',
  projectAddress: '1214 Cedar Lane, Spokane WA',
  contractAmount: 68400,
  clientEmail: 'dana@example.com',
  clientPhone: '509-555-0134',
};

// ── Where the chain stops today ──────────────────────────────────────────────

test('an unsigned deal stops at the first step, which is every deal today', () => {
  const r = replaySignedDeal(deal());
  assert.equal(r.completed, false);
  assert.equal(r.stoppedAt, 'deal_is_signed');
  assert.equal(r.steps.length, 1, 'must not evaluate later steps once it stops');
});

test('a signed deal with no shared key stops at the key — this is C-3, measured', () => {
  // Every measured row has an empty ghl_opportunity_id and no BSP value at all.
  const r = replaySignedDeal(deal({ signed: true, signatureStatus: 'SIGNED' }));
  assert.equal(r.stoppedAt, 'shared_key_present');
  assert.ok(r.missingFields.includes(SHARED_KEY_FIELD));
  assert.equal(r.plan, null);
});

test('with a key but nothing else, it stops on the fields BuildSuite must send', () => {
  const r = replaySignedDeal(deal({ signed: true }), { sharedKey: 'BSP-2026-000184' });
  assert.equal(r.stoppedAt, 'handoff_payload_complete');
  assert.deepEqual(r.missingFields, [...FIELDS_DEAL_CANNOT_SUPPLY]);
});

test('a malformed shared key is refused by the contract, not passed through', () => {
  // §5 requires BSP-YYYY-NNNNNN. A raw row id must not slip past.
  const r = replaySignedDeal(deal({ signed: true }), { ...SUPPLIED, sharedKey: '9f3a-not-a-bsp' });
  assert.equal(r.stoppedAt, 'handoff_payload_valid');
  assert.equal(r.completed, false);
});

// ── What happens when the missing pieces arrive ──────────────────────────────

test('a fully supplied signed deal completes the chain and plans WF1', () => {
  const r = replaySignedDeal(
    deal({ signed: true, matched: true, ghlContactId: 'ghl-contact-1', ghlOpportunityId: 'opp-1' }),
    SUPPLIED,
  );
  assert.equal(r.completed, true, describeReplay(r));
  assert.equal(r.stoppedAt, null);
  assert.ok(r.plan?.ran);
  assert.ok(r.plan!.ran && r.plan.effects.length > 0);
});

/** The effects of a replay that was expected to reach WF1. Fails loudly if it didn't. */
function effectsOf(result: ReplayResult): Effect[] {
  const plan = result.plan;
  assert.ok(plan !== null, `expected a WF1 plan:\n${describeReplay(result)}`);
  assert.ok(plan.ran, `expected WF1 to run:\n${describeReplay(result)}`);
  return plan.ran ? plan.effects : [];
}

function countOfType(result: ReplayResult, type: Effect['type']): number {
  return effectsOf(result).filter((e) => e.type === type).length;
}

test('WF1 seeds a project, its milestones and its portal access', () => {
  const types: string[] = effectsOf(replaySignedDeal(deal({ signed: true }), SUPPLIED)).map(
    (e) => e.type,
  );
  for (const expected of ['CreateProject', 'CreateMilestone', 'PrepareClientPortalAccess']) {
    assert.ok(types.includes(expected), `expected a ${expected} effect`);
  }
});

test('a re-sent handoff does not seed the project twice', () => {
  // A retried delivery or a re-sent proposal is legitimate. Duplicated
  // milestones are not.
  const first = replaySignedDeal(deal({ signed: true }), SUPPLIED);
  const again = replaySignedDeal(deal({ signed: true }), SUPPLIED, { projectExists: true });
  assert.equal(countOfType(first, 'CreateProject'), 1);
  assert.equal(
    countOfType(again, 'CreateProject'),
    0,
    'the second handoff must not create the project again',
  );
  assert.equal(countOfType(again, 'CreateMilestone'), 0, 'nor duplicate the milestones');
});

test('a handoff with no project manager warns rather than going quiet', () => {
  const messages = effectsOf(replaySignedDeal(deal({ signed: true }), SUPPLIED))
    .filter((e) => e.type === 'NotifyInternal')
    .map((e) => ('message' in e ? e.message : ''));
  assert.ok(
    messages.some((m) => m.includes('without a project manager')),
    'an unassigned project has nobody to review field updates',
  );
});

// ── sent_to_crm without a signature ──────────────────────────────────────────

test('handoff-fired-without-signature still runs, and says so', () => {
  // 2 of 182 rows are in exactly this state. isSignedWork treats it as won;
  // the replay records which signal it was, so the ambiguity is visible rather
  // than silently folded into "signed".
  const r = replaySignedDeal(deal({ signed: false, sentToCrm: true }), SUPPLIED);
  assert.equal(r.completed, true);
  assert.match(r.steps[0]!.detail, /without a captured signature/);
});

// ── The payload builder ──────────────────────────────────────────────────────

test('the project name is built from the deal, never left blank', () => {
  const { payload } = handoffFromDeal(deal(), SUPPLIED);
  assert.equal(payload.project_name, 'Dana Johnson — Kitchen Remodel');
  const partial = handoffFromDeal(deal({ projectType: '' }), SUPPLIED);
  assert.equal(partial.payload.project_name, 'Dana Johnson');
});

test('a deal row alone can never complete the payload', () => {
  // If this ever passes with an empty `supplied`, the deals reader has started
  // selecting client PII and that is a privacy regression, not a win.
  const { missing } = handoffFromDeal(deal({ projectId: 'BSP-2026-000184' }));
  assert.deepEqual(missing, [...FIELDS_DEAL_CANNOT_SUPPLY]);
});

// ── The routing wire ─────────────────────────────────────────────────────────

test('§11 a Send-to-CRM webhook routes to WF1', () => {
  const r = routeWebhook({ id: 'evt-1', type: 'SentToCrm', locationId: 'loc-1', raw: {} });
  assert.ok(r.handled && r.workflow === 'WF1');
});

test('the WF1 mapping tolerates the naming GHL might actually use', () => {
  for (const type of ['sent_to_crm', 'Contact.SentToCRM', 'project-handoff', 'HandoffReceived']) {
    const r = routeWebhook({ id: 'e', type, locationId: 'loc-1', raw: {} });
    assert.ok(r.handled && r.workflow === 'WF1', `"${type}" should route to WF1`);
  }
});

test('a handoff event with no location is refused, not scoped to a guess', () => {
  const r = routeWebhook({ id: 'e', type: 'senttocrm', locationId: null, raw: {} });
  assert.equal(r.handled, false);
});

test('WF1 event types are listed for the ask to Pat', () => {
  assert.ok(mappedEventTypes().includes('senttocrm'));
});

// ── The C-3 guard ────────────────────────────────────────────────────────────

test('C-3 the shared key lives in exactly one place, and is still unconfirmed', () => {
  // This test is a tripwire. When Chris confirms C-3, flip SHARED_KEY_CONFIRMED
  // and update this assertion deliberately — do not let it drift silently.
  assert.equal(SHARED_KEY_CONFIRMED, false);
  assert.equal(SHARED_KEY, 'buildsuite_project_id');
  assert.match(sharedKeyStatus(), /PROPOSED/);
});
