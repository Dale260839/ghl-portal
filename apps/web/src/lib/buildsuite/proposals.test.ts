/**
 * Reading `proposals`, and the tenancy hole that reading it opened.
 *
 * `proposals` carries no `auth_profile_id`. Every other BuildSuite table the Hub
 * reads does, so "pass the scope and it is filtered" held everywhere until this
 * table. Here the scope only *asserts*; the filter has to be the contractor, and
 * a contractor has to be resolved before anything can be shown.
 *
 * Caught in review on 2026-08-31: both tenants were seeing all seven live
 * engagements. These are the tests that keep it fixed.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BuildSuiteClient } from './client.ts';
import {
  NO_CONTRACTOR,
  PROPOSAL_COLUMNS,
  SupabaseProposalsReader,
  normalizeProposal,
  type BuildSuiteProposalRow,
} from './proposals.ts';
import { ContractorResolver } from './contractor-identity.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const scope: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
};

function fake(responses: unknown[] = [[]]) {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient({ url: 'https://bs.example', key: 'k' }, { fetchImpl });
  return { urls, reader: new SupabaseProposalsReader(client), resolver: new ContractorResolver(client) };
}

// ── The leak, and its guard ─────────────────────────────────────────────────

test('a live read is filtered by contractor, not merely scoped', () => {
  // The bug: `proposals` has no auth_profile_id, so a scope-only read returned
  // every contractor's work to anyone signed in.
  const { reader, urls } = fake();

  return reader.listLive(scope, 'contractor-1').then(() => {
    assert.match(urls[0]!, /contractor_id=eq\.contractor-1/);
    assert.match(urls[0]!, /status=in\.\(submitted%2Caccepted\)|status=in\./);
  });
});

test('an empty contractor id is refused, not defaulted', async () => {
  // `contractor_id=eq.` is a valid PostgREST filter matching the empty string,
  // so the failure would look like "no work" rather than "no filter" — the
  // worst kind, because it looks fine.
  const { reader, urls } = fake();

  await assert.rejects(() => reader.listLive(scope, ''), TypeError);
  await assert.rejects(() => reader.listLive(scope, '   '), TypeError);
  assert.deepEqual(urls, [], 'nothing may reach the network without a contractor');
});

test('a live read still refuses without a scope', async () => {
  const { reader, urls } = fake();

  await assert.rejects(
    () => reader.listLive(null as unknown as TenantScope, 'contractor-1'),
    TenancyError,
  );
  assert.deepEqual(urls, []);
});

test('a project lookup with no ids never reaches the network', async () => {
  const { reader, urls } = fake();

  assert.deepEqual(await reader.listForProjects(scope, []), []);
  assert.deepEqual(urls, []);
});

// ── Resolving which contractor a session is ─────────────────────────────────

test('the dedicated column wins when it is populated', async () => {
  const { resolver, urls } = fake([
    [{ id: 'p1', contractor_id: 'c-linked', email: 'ralph@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, true);
  assert.equal(result.identity.contractorId, 'c-linked');
  assert.equal(result.identity.via, 'auth_profile');
  assert.equal(urls.length, 1, 'no email lookup is needed when the link exists');
});

test('email is the fallback, and only on an exact single match', async () => {
  const { resolver } = fake([
    [{ id: 'p1', contractor_id: null, email: 'Ralph@Example.com' }],
    [{ id: 'c-by-email', email: 'ralph@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, true);
  assert.equal(result.identity.contractorId, 'c-by-email');
  assert.equal(result.identity.via, 'email');
});

test('an ambiguous email resolves to nothing rather than guessing', async () => {
  // Two contractors sharing an address. Picking one would silently show a
  // person somebody else's book of work.
  const { resolver } = fake([
    [{ id: 'p1', contractor_id: null, email: 'shared@example.com' }],
    [{ id: 'c-1', email: 'shared@example.com' }, { id: 'c-2', email: 'shared@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, false);
  assert.equal(result.reason, 'unlinked');
});

test('an unlinked profile with no email resolves to nothing', async () => {
  const { resolver } = fake([[{ id: 'p1', contractor_id: null, email: null }]]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, false);
});

test('resolving refuses without a scope', async () => {
  const { resolver, urls } = fake();

  await assert.rejects(() => resolver.resolve(null as unknown as TenantScope), TenancyError);
  assert.deepEqual(urls, []);
});

test('the resolver never matches on a name or a company', async () => {
  // §3.6 and D4 §6: a rename must not silently repoint a cross-system link.
  const { resolver, urls } = fake([
    [{ id: 'p1', contractor_id: null, email: 'ralph@example.com' }],
    [{ id: 'c1', email: 'ralph@example.com' }],
  ]);

  await resolver.resolve(scope);
  for (const url of urls) {
    assert.equal(/business_name=|full_name=|title=/.test(url), false);
  }
});

// ── Columns and normalization ───────────────────────────────────────────────

test('the column list excludes documents and internal text', () => {
  for (const banned of [
    'content',
    'sections',
    'pdf_url',
    'docx_url',
    'signed_pdf_url',
    'ai_feedback',
    'notes',
    'share_feedback',
  ]) {
    assert.equal((PROPOSAL_COLUMNS as readonly string[]).includes(banned), false, `selects ${banned}`);
  }
});

function row(over: Partial<BuildSuiteProposalRow> = {}): BuildSuiteProposalRow {
  return {
    id: 'p1',
    project_id: 'proj-1',
    contractor_id: 'c1',
    status: 'submitted',
    price: '8000.0',
    subtotal: null,
    total: null,
    valid_until: null,
    timeline: '',
    created_at: '2026-02-01T10:00:00Z',
    updated_at: null,
    submitted_at: null,
    accepted_at: null,
    rejected_at: null,
    signature_status: null,
    signature_sent_at: null,
    signature_signed_at: null,
    source_deal_id: null,
    deleted_at: null,
    ...over,
  };
}

test('the placeholder contractor id reads as no contractor', () => {
  assert.equal(normalizeProposal(row({ contractor_id: NO_CONTRACTOR })).contractorId, null);
});

test('SIGNED counts as signed even with no timestamp', () => {
  // The status and the timestamp are written by different steps of Adobe's
  // callback, and either alone is evidence.
  assert.equal(normalizeProposal(row({ signature_status: 'SIGNED' })).signed, true);
  assert.equal(
    normalizeProposal(row({ signature_signed_at: '2026-02-11T02:51:28Z' })).signed,
    true,
  );
  assert.equal(normalizeProposal(row({ signature_status: 'SENT' })).signed, false);
});

test('an updated_at that is missing falls back to created_at', () => {
  // Otherwise "most recently updated wins" would rank a row with no
  // updated_at below everything, including older ones.
  assert.equal(normalizeProposal(row()).updatedAt, '2026-02-01T10:00:00Z');
});
