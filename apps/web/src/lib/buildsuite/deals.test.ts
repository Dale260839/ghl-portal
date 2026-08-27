/**
 * Reading BuildSuite's `deals`.
 *
 * Three groups of test, in order of what would hurt most if it broke:
 *
 *   1. **Tenancy** — an unscoped read of this table would expose every
 *      contractor's pipeline to every other one. `deals` carries client names
 *      and budgets across all 182 rows.
 *   2. **The signed definition** — `isSignedWork` decides which projects appear
 *      once the filter is on. Getting it wrong shows a contractor work that is
 *      not theirs to start, or hides work that is.
 *   3. **The funnel arithmetic** — including that an unknown stage is surfaced
 *      rather than dropped, because the stage vocabulary is BuildSuite's.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEAL_COLUMNS,
  DEAL_STAGES,
  buildFunnel,
  daysStalled,
  isSignedWork,
  normalizeDeal,
  SupabaseDealsReader,
  type BuildSuiteDealRow,
  type Deal,
} from './deals.ts';
import { BuildSuiteClient } from './client.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const PROFILE_A = '1dca7b15-9904-449b-a702-5725a5d1b069';
const PROFILE_B = 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01';
const scope: TenantScope = {
  locationId: 'IifYfP2B2NUaoDPdsTTa',
  authProfileIds: [PROFILE_A, PROFILE_B],
};

/** Shaped after a real row: most lifecycle columns are empty in practice. */
function row(over: Partial<BuildSuiteDealRow> = {}): BuildSuiteDealRow {
  return {
    id: 'c5f251e0-77c4-4279-b629-e6f89da5e999',
    status: 'draft_ready',
    source: 'ghl_project_quote_survey',
    created_at: '2026-08-01T10:00:00+00:00',
    updated_at: '2026-08-02T10:00:00+00:00',
    auth_profile_id: PROFILE_A,
    source_project_id: null,
    matched_contractor_id: null,
    sent_to_crm_at: null,
    signature_status: null,
    signature_signed_at: null,
    client_name: 'Chris Carr',
    project_type: 'kitchen',
    budget_range: '$50,000 - $100,000',
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    coverage_score: 0.82,
    ...over,
  };
}

const deal = (over: Partial<BuildSuiteDealRow> = {}): Deal => normalizeDeal(row(over));

// ── 1 · Tenancy ──────────────────────────────────────────────────────────────

test('the column list excludes the credential and the PII', () => {
  // The publishable key permits these; not selecting them is our half of that.
  for (const banned of [
    'access_token',
    'client_email',
    'client_phone',
    'photo_urls',
    'photo_analysis',
    'metadata',
    'signed_pdf_url',
  ]) {
    assert.equal(
      (DEAL_COLUMNS as readonly string[]).includes(banned),
      false,
      `DEAL_COLUMNS selects ${banned}`,
    );
  }
});

test('every selected column is one the reader actually maps', () => {
  const mapped = Object.keys(row());
  for (const column of DEAL_COLUMNS) {
    assert.ok(mapped.includes(column), `${column} is selected but never read`);
  }
});

test('the reader can only issue GET requests', async () => {
  // Same guarantee as the projects client: `deals` is read-only by construction,
  // not by policy. This pins that the shared client has not gained a writer.
  const surface = Object.getOwnPropertyNames(BuildSuiteClient.prototype).sort();
  assert.deepEqual(surface, ['constructor', 'count', 'select']);
});

/** A client whose fetch records the URL and returns rows, so we can see the filter. */
function fakeReader(rows: BuildSuiteDealRow[] = []) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': `0-0/${rows.length}` },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient(
    { url: 'https://example.supabase.co', key: 'test-key' },
    { fetchImpl },
  );
  return { reader: new SupabaseDealsReader(client), urls };
}

test('the reader refuses to list deals without a scope', async () => {
  const { reader, urls } = fakeReader();

  await assert.rejects(
    () => reader.listDeals(null as unknown as TenantScope),
    TenancyError,
    'an unscoped read would expose every contractor pipeline to every other one',
  );
  assert.deepEqual(urls, [], 'it must refuse before reaching the network');
});

test('the reader refuses a scope carrying no profiles', async () => {
  // PostgREST `in.()` with an empty list matches nothing silently, which reads
  // as "this contractor has no deals" rather than "the scope was never set".
  const { reader, urls } = fakeReader();

  await assert.rejects(
    () => reader.listDeals({ locationId: 'x', authProfileIds: [] }),
    TenancyError,
  );
  assert.deepEqual(urls, []);
});

test('every scoped read filters on the caller’s own profiles', async () => {
  const { reader, urls } = fakeReader([row()]);

  await reader.listDeals(scope);
  await reader.dealFunnel(scope);
  await reader.listDealsForProjects(scope, ['BSP-1']);

  assert.equal(urls.length, 3);
  for (const url of urls) {
    assert.match(url, /auth_profile_id=in\./, 'a read went out without a tenant filter');
    assert.ok(url.includes(PROFILE_A) && url.includes(PROFILE_B));
  }
});

test('a project-id lookup with no ids never reaches the network', async () => {
  // `in.()` again — an empty list would match nothing and look like an answer.
  const { reader, urls } = fakeReader();

  assert.deepEqual(await reader.listDealsForProjects(scope, []), []);
  assert.deepEqual(urls, []);
});

// ── 2 · What counts as won ───────────────────────────────────────────────────

test('a signature makes a deal signed work', () => {
  assert.equal(isSignedWork(deal({ signature_signed_at: '2026-08-20T09:00:00Z' })), true);
});

test('reaching the CRM makes a deal signed work even without a signature timestamp', () => {
  // The two do not always arrive together — the signature is captured first and
  // the handoff fires after. Either is enough to say the work was won.
  assert.equal(isSignedWork(deal({ sent_to_crm_at: '2026-08-20T09:05:00Z' })), true);
});

test('a signature merely SENT is not won', () => {
  const sent = deal({ signature_status: 'SENT' });

  assert.equal(sent.signatureStatus, 'SENT');
  assert.equal(sent.signed, false);
  assert.equal(isSignedWork(sent), false, 'sent for signature is not signed');
});

test('a deal at draft_ready is not won', () => {
  assert.equal(isSignedWork(deal()), false);
});

// ── 3 · Normalizing ──────────────────────────────────────────────────────────

test('the lifecycle facts read as booleans, not as raw strings', () => {
  const d = deal({
    matched_contractor_id: 'effef732-09a8-42bf-a089-68aca578c2a6',
    sent_to_crm_at: '2026-08-20T09:05:00Z',
    signature_signed_at: '2026-08-20T09:00:00Z',
    source_project_id: 'BSP-2026-000184',
  });

  assert.equal(d.matched, true);
  assert.equal(d.sentToCrm, true);
  assert.equal(d.signed, true);
  assert.equal(d.projectId, 'BSP-2026-000184');
});

test('empty strings are treated as absent, not as present', () => {
  // BuildSuite writes '' rather than null in places — `trade` is '' on every
  // live project row. A blank id must not read as a match.
  const d = deal({ matched_contractor_id: '   ', source_project_id: '', ghl_contact_id: '' });

  assert.equal(d.matched, false);
  assert.equal(d.projectId, null);
  assert.equal(d.ghlContactId, null);
});

test('a deal with no status lands in its own bucket rather than crashing', () => {
  assert.equal(deal({ status: null }).stage, 'unknown');
});

// ── 4 · The funnel ───────────────────────────────────────────────────────────

test('the funnel counts every known stage, including the empty ones', () => {
  const funnel = buildFunnel(
    [deal(), deal({ status: 'draft_ready' }), deal({ status: 'intake_started' })],
    3,
  );

  assert.equal(funnel.total, 3);
  // Every stage appears even at zero — a funnel that hides its empty steps
  // hides where things stop, which is the whole point of looking at it.
  for (const stage of DEAL_STAGES) {
    assert.ok(
      funnel.stages.some((s) => s.stage === stage),
      `${stage} is missing from the funnel`,
    );
  }
  assert.equal(funnel.stages.find((s) => s.stage === 'draft_ready')?.count, 2);
});

test('an unrecognised stage is surfaced, not dropped', () => {
  const funnel = buildFunnel([deal({ status: 'awaiting_deposit' })], 1);

  const unknown = funnel.stages.find((s) => s.stage === 'awaiting_deposit');
  assert.ok(unknown, 'a new BuildSuite status vanished from the funnel');
  assert.equal(unknown.known, false, 'it should be marked as unrecognised');
  // And the totals must still reconcile, or the screen lies.
  assert.equal(
    funnel.stages.reduce((sum, s) => sum + s.count, 0),
    funnel.total,
  );
});

test('the derived milestones cut across stages', () => {
  const funnel = buildFunnel(
    [
      deal({ matched_contractor_id: 'c1' }),
      deal({ matched_contractor_id: 'c2', sent_to_crm_at: '2026-08-20T09:00:00Z' }),
      deal({ source_project_id: 'BSP-1' }),
      deal(),
    ],
    4,
  );

  assert.equal(funnel.matched, 2);
  assert.equal(funnel.sentToCrm, 1);
  assert.equal(funnel.signed, 0);
  assert.equal(funnel.linkedToProject, 1);
});

test('an empty tenant funnels to zeros rather than throwing', () => {
  const funnel = buildFunnel([], 0);

  assert.equal(funnel.total, 0);
  assert.equal(funnel.matched, 0);
  assert.equal(funnel.stages.length, DEAL_STAGES.length);
  assert.ok(funnel.stages.every((s) => s.count === 0));
});

test('the funnel states its own coverage', () => {
  // auth_profile_id is populated on roughly half of `deals`, so a scoped count
  // undercounts. The number must travel with that caveat attached.
  const funnel = buildFunnel([deal()], 1);

  assert.equal(funnel.coverage.scoped, 1);
  assert.match(funnel.coverage.note, /auth profile/i);
});

test('the real Alliance shape reproduces: deals, none matched, none signed', () => {
  // 23 deals measured 2026-08-28 — 4 intake_started, 3 intake_complete,
  // 16 draft_ready. This pins the shape the pipeline screen must render.
  const alliance = [
    ...Array.from({ length: 4 }, () => deal({ status: 'intake_started' })),
    ...Array.from({ length: 3 }, () => deal({ status: 'intake_complete' })),
    ...Array.from({ length: 16 }, () => deal({ status: 'draft_ready' })),
  ];

  const funnel = buildFunnel(alliance, alliance.length);

  assert.equal(funnel.total, 23);
  assert.equal(funnel.stages.find((s) => s.stage === 'draft_ready')?.count, 16);
  assert.equal(funnel.matched, 0, 'nothing has been matched');
  assert.equal(funnel.signed, 0, 'nothing has been signed');
});

// ── 5 · Stall ────────────────────────────────────────────────────────────────

test('days stalled measures from the last movement, not from creation', () => {
  const now = new Date('2026-08-28T10:00:00Z');

  const moved = deal({ created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-26T10:00:00Z' });
  assert.equal(daysStalled(moved, now), 2);
});

test('a deal that never moved is measured from creation', () => {
  const now = new Date('2026-08-28T10:00:00Z');
  const never = deal({ created_at: '2026-08-18T10:00:00Z', updated_at: null });

  assert.equal(daysStalled(never, now), 10);
});

test('an unparseable date is zero rather than NaN on a screen', () => {
  const now = new Date('2026-08-28T10:00:00Z');
  assert.equal(daysStalled(deal({ created_at: 'not a date', updated_at: null }), now), 0);
});
