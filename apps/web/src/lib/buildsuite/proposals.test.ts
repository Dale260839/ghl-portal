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
    [{ id: 'p1', contractor_id: 'c-linked', contact_id: 'ghl-1', email: 'ralph@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, true);
  assert.equal(result.identity.contractorId, 'c-linked');
  assert.equal(result.identity.via, 'auth_profile');
  assert.equal(urls.length, 1, 'no email lookup is needed when the link exists');
});

test('the GoHighLevel contact id is tried before email', async () => {
  // Better covered than the dedicated column: contractors.ghl_contact_id is set
  // on 472 of 483, because it is written when a contractor is onboarded through
  // GHL — which is how they all arrive.
  const { resolver } = fake([
    [{ id: 'p1', contractor_id: null, contact_id: 'ghl-123', email: 'ralph@example.com' }],
    [{ id: 'c-by-contact', ghl_contact_id: 'ghl-123' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, true);
  assert.equal(result.identity.contractorId, 'c-by-contact');
  assert.equal(result.identity.via, 'ghl_contact');
});

test('an ambiguous contact id falls through rather than guessing', async () => {
  // Seven contact ids in the live data are shared by more than one contractor.
  const { resolver } = fake([
    [{ id: 'p1', contractor_id: null, contact_id: 'shared', email: 'ralph@example.com' }],
    [{ id: 'c-1', ghl_contact_id: 'shared' }, { id: 'c-2', ghl_contact_id: 'shared' }],
    [{ id: 'c-by-email', email: 'ralph@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, true);
  assert.equal(result.identity.via, 'email', 'it must fall through, not pick one');
});

test('email is the last fallback, and only on an exact single match', async () => {
  const { resolver } = fake([
    [{ id: 'p1', contractor_id: null, contact_id: null, email: 'Ralph@Example.com' }],
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
    [{ id: 'p1', contractor_id: null, contact_id: null, email: 'shared@example.com' }],
    [{ id: 'c-1', email: 'shared@example.com' }, { id: 'c-2', email: 'shared@example.com' }],
  ]);

  const result = await resolver.resolve(scope);
  assert.equal(result.resolved, false);
  assert.equal(result.reason, 'unlinked');
});

test('an unlinked profile with no email resolves to nothing', async () => {
  const { resolver } = fake([[{ id: 'p1', contractor_id: null, contact_id: null, email: null }]]);

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
    [{ id: 'p1', contractor_id: null, contact_id: null, email: 'ralph@example.com' }],
    [{ id: 'c1', email: 'ralph@example.com' }],
  ]);

  await resolver.resolve(scope);
  for (const url of urls) {
    assert.equal(/business_name=|full_name=|title=/.test(url), false);
  }
});

// ── Columns and normalization ───────────────────────────────────────────────

test('the column list excludes documents and internal text', () => {
  // `signed_pdf_url` was on this list until 2026-09-09 and has deliberately
  // been removed from it — see the test below. The rest stay excluded:
  // `content` and `sections` are large and are fetched by a targeted read when
  // a schedule is actually needed; the others are the contractor's own working
  // notes, which no screen shows and a client must never see.
  for (const banned of ['content', 'sections', 'pdf_url', 'docx_url', 'ai_feedback', 'notes', 'share_feedback']) {
    assert.equal((PROPOSAL_COLUMNS as readonly string[]).includes(banned), false, `selects ${banned}`);
  }
});

test('the signed contract link IS selected, by decision', () => {
  // A DECISION CHANGE, not a relaxation. D-010 minimisation excluded document
  // columns because "the Hub has no screen that needs them". As of 2026-09-09
  // there is one: the contractor opens the signed contract from the engagement
  // and invoice screens.
  //
  // Three reasons this one is different from `pdf_url` and `docx_url`, which
  // stay excluded:
  //
  //   · it is a URL, not the document — small, and no client data travels
  //   · it is the SIGNED contract, the only version anyone asked to see
  //   · it is needed for every signed row at once, so a per-row targeted read
  //     would be an N+1 against a production database
  //
  // There is no such column on `projects`. The ask was to add one there; the
  // join already exists, and a copy would be a second thing to keep in sync.
  assert.ok(
    (PROPOSAL_COLUMNS as readonly string[]).includes('signed_pdf_url'),
    'the signed contract cannot be shown if it is not selected',
  );
});

function row(over: Partial<BuildSuiteProposalRow> = {}): BuildSuiteProposalRow {
  return {
    id: 'p1',
    project_id: 'proj-1',
    contractor_id: 'c1',
    status: 'submitted',
    price: '8000.0',
    signed_pdf_url: null,
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

// ── Exact pricing, not a range (2026-09-09) ─────────────────────────────────

test('a price that is one exact number becomes the amount', () => {
  // 33 of 48 proposals store the figure this way. Before today only the 10
  // with a numeric `total` had an amount at all.
  for (const [price, expected] of [
    ['24500.00', 24500],
    ['8000.0', 8000],
    ['112', 112],
    ['$1,773.75', 1773.75],
    [' 39600.0 ', 39600],
  ] as const) {
    const p = normalizeProposal(row({ price, subtotal: null, total: null }));
    assert.equal(p.amount, expected, `"${price}" did not read as ${expected}`);
    assert.equal(p.amountSource, 'price');
  }
});

test('§ a BAND never becomes a number — it would quote the bottom of the range', () => {
  // The failure that matters. "$2,000 - $5,000" read as 2000 quotes a homeowner
  // the low end of a job that might cost the high end.
  for (const band of ['$2,000 - $5,000', '2000-5000', '$10k - $20k', 'around 12k', 'TBD', '']) {
    const p = normalizeProposal(row({ price: band, subtotal: null, total: null }));
    assert.equal(p.amount, null, `"${band}" was parsed into ${p.amount}`);
    assert.equal(p.amountSource, 'none');
  }
});

test('the numeric columns outrank the text one', () => {
  // `total` is typed; `price` is text that happens to parse. If they disagree,
  // the typed column is the contract.
  const both = normalizeProposal(row({ price: '999.00', subtotal: 500, total: 24500 }));
  assert.equal(both.amount, 24500);
  assert.equal(both.amountSource, 'total');

  const noTotal = normalizeProposal(row({ price: '999.00', subtotal: 500, total: null }));
  assert.equal(noTotal.amount, 500);
  assert.equal(noTotal.amountSource, 'subtotal');
});

test('the price text is kept verbatim alongside the parsed amount', () => {
  // The screen shows the exact figure; the original stays available so a
  // contractor can see what BuildSuite actually recorded.
  const p = normalizeProposal(row({ price: '$2,000 - $5,000', subtotal: null, total: null }));
  assert.equal(p.priceText, '$2,000 - $5,000');
  assert.equal(p.amount, null);
});

test('the signed contract link is surfaced when there is one', () => {
  assert.equal(normalizeProposal(row()).signedPdfUrl, null);
  assert.equal(
    normalizeProposal(row({ signed_pdf_url: 'https://example.com/signed.pdf' })).signedPdfUrl,
    'https://example.com/signed.pdf',
  );
  // Blank is null, not an empty string a screen would render as a live link.
  assert.equal(normalizeProposal(row({ signed_pdf_url: '   ' })).signedPdfUrl, null);
});

// ── The signed contract link is public — treat it as sensitive ──────────────

test('§ the literal string "null" is not a link', () => {
  // A real live row (027b2b2f) stores the four characters "null" rather than
  // SQL NULL. Rendered, that is <a href="null">Signed contract</a> — a dead
  // link labelled as the contract, which is worse than showing nothing because
  // a contractor reports the document as missing rather than absent.
  for (const junk of ['null', 'NULL', 'undefined', 'none', 'N/A', 'false', '0', '   ', '']) {
    assert.equal(
      normalizeProposal(row({ signed_pdf_url: junk })).signedPdfUrl,
      null,
      `"${junk}" was treated as a link`,
    );
  }
});

test('a value that is not a URL is refused rather than linked', () => {
  for (const junk of ['pending', 'see GHL', '/relative/path', 'ftp://x/y']) {
    assert.equal(normalizeProposal(row({ signed_pdf_url: junk })).signedPdfUrl, null);
  }
});

test('a real signed URL survives, from either host', () => {
  // Both shapes occur live: Supabase Storage on the older rows, GoHighLevel on
  // the newer ones.
  for (const url of [
    'https://bkngicyqgdwzmoeahqdi.supabase.co/storage/v1/object/public/proposals/x/signed_a1.pdf',
    'https://services.leadconnectorhq.com/proposals/document/public/download-pdf?p=location/x',
  ]) {
    assert.equal(normalizeProposal(row({ signed_pdf_url: url })).signedPdfUrl, url);
  }
});
