import { test } from 'node:test';
import assert from 'node:assert/strict';

import { draftFromStored, resolveInvoiceRail } from './rail.ts';
import type { StoredInvoiceDraft } from '../hub-db/invoice-drafts.ts';
import type { Project } from '../data/types.ts';

function stored(over: Partial<StoredInvoiceDraft> = {}): StoredInvoiceDraft {
  return {
    id: 'draft-1',
    projectId: 'proj-1',
    proposalId: 'prop-1',
    lineOrder: 1,
    sourcePercent: 30,
    sourceAmount: null,
    sourceRaw: '- **30%** upon signing',
    title: 'Contract Signing',
    amount: 7350,
    description: 'Upon signing and scheduling',
    notes: null,
    status: 'draft',
    externalId: null,
    externalUrl: null,
    railCreatedAt: null,
    sentVia: null,
    sentAt: null,
    updatedAt: '2026-09-08T00:00:00.000Z',
    updatedBy: 'Ralph',
    ...over,
  };
}

const PROJECT = {
  buildsuiteProjectId: 'proj-1',
  projectCode: 'BSA-052',
  clientName: 'Ellen Johnson',
  primaryContactId: 'ghl-contact-1',
} as unknown as Project;

test('the invoice is built from the CONTRACTOR’S draft, not the parsed line', () => {
  // By the time this runs the contractor has reviewed and possibly corrected
  // every field. The parse is history; their edit is the document.
  const invoice = draftFromStored(
    stored({ title: 'Deposit (corrected)', amount: 8000, description: 'Net 14' }),
    PROJECT,
  );

  assert.equal(invoice.milestone, 'Deposit (corrected)');
  assert.equal(invoice.amount, 8000);
  assert.equal(invoice.terms, 'Net 14');
});

test('§ an invoice with no amount is refused rather than defaulted', () => {
  // The one figure that must never reach a homeowner is one nobody chose.
  assert.throws(() => draftFromStored(stored({ amount: null }), PROJECT), /no amount/i);
});

test('the project code is stamped on the reference (Chris’s ask)', () => {
  assert.match(draftFromStored(stored(), PROJECT).reference, /BSA-052/);
  assert.equal(draftFromStored(stored(), PROJECT).projectCode, 'BSA-052');
});

test('a pending code yields a reference without one, never the word null', () => {
  // 53 of 103 projects have no code yet. "null · Invoice 1" on a real invoice
  // is the kind of thing a homeowner screenshots.
  const noCode = { ...PROJECT, projectCode: null } as Project;
  const invoice = draftFromStored(stored(), noCode);

  assert.equal(invoice.reference, 'Invoice 1');
  assert.doesNotMatch(invoice.reference, /null/);
  assert.equal(invoice.projectCode, null);
});

test('a missing title does not produce a dangling separator', () => {
  // On all four signed proposals the schedule states a percent and no name.
  const invoice = draftFromStored(stored({ title: null }), PROJECT);
  assert.equal(invoice.description, 'Upon signing and scheduling');
  assert.doesNotMatch(invoice.description, /^ — | — $/);
});

test('a missing description falls back to the title alone', () => {
  const invoice = draftFromStored(stored({ description: null }), PROJECT);
  assert.equal(invoice.description, 'Contract Signing');
});

test('line 1 is the deposit and later lines are not', () => {
  assert.equal(draftFromStored(stored({ lineOrder: 1 }), PROJECT).isDeposit, true);
  assert.equal(draftFromStored(stored({ lineOrder: 3 }), PROJECT).isDeposit, false);
});

// ── Which rail, and what happens without credentials ─────────────────────────

test('§ no credentials means a rail that REFUSES, never one that pretends', () => {
  // A composed invoice that silently reaches nobody is worse than one that
  // fails loudly: the contractor would believe a homeowner had been invoiced.
  const rail = resolveInvoiceRail({} as NodeJS.ProcessEnv);
  assert.equal(rail.name, 'unconfigured');

  return rail
    .createDraft(draftFromStored(stored(), PROJECT), {
      ghlContactId: 'c',
      name: 'n',
      email: 'e@example.com',
    })
    .then((result) => {
      assert.equal(result.created, false);
    });
});

test('a blank location id is treated as unconfigured, not as a location', () => {
  // An empty locationId would post the invoice to whatever the API defaults to.
  const rail = resolveInvoiceRail({
    GHL_API_TOKEN: 'tok',
    GHL_LOCATION_ID: '   ',
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(rail.name, 'unconfigured');
});

// ── Ambiguous failures (found in the 2026-09-08 review) ─────────────────────

import { createGhlInvoiceRail } from './ghl-rail.ts';

function railWith(fetchImpl: typeof fetch) {
  return createGhlInvoiceRail({ token: 't', locationId: 'loc', fetchImpl });
}

const RECIPIENT = { ghlContactId: 'c1', name: 'Ellen', email: 'e@example.com' };
const INVOICE = () => draftFromStored(stored(), PROJECT);

test('a 2xx we cannot parse is UNCERTAIN, not a clean failure', async () => {
  // GHL accepted it, so the invoice probably exists. Reporting a plain failure
  // invites a retry, and the retry creates a second real invoice.
  const rail = railWith((async () =>
    new Response('<html>gateway</html>', { status: 200 })) as unknown as typeof fetch);

  const result = await rail.createDraft(INVOICE(), RECIPIENT);
  assert.equal(result.created, false);
  assert.equal(result.created === false && result.uncertain, true);
});

test('a 2xx with no invoice id is uncertain', async () => {
  const rail = railWith((async () =>
    new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch);

  const result = await rail.createDraft(INVOICE(), RECIPIENT);
  assert.equal(result.created === false && result.uncertain, true);
});

test('a 5xx is uncertain but a 4xx is a clean refusal', async () => {
  // A 4xx was rejected and nothing was written — safe to retry. A 5xx may have
  // committed before failing.
  const five = railWith((async () => new Response('{}', { status: 502 })) as unknown as typeof fetch);
  const four = railWith((async () => new Response('{}', { status: 400 })) as unknown as typeof fetch);

  const a = await five.createDraft(INVOICE(), RECIPIENT);
  const b = await four.createDraft(INVOICE(), RECIPIENT);

  assert.equal(a.created === false && a.uncertain, true, 'a 5xx must not invite a retry');
  assert.equal(b.created === false && (b.uncertain ?? false), false, 'a 4xx is safe to retry');
});

test('a dropped connection is uncertain — the request may have landed', async () => {
  const rail = railWith((async () => {
    throw new Error('ECONNRESET');
  }) as unknown as typeof fetch);

  const result = await rail.createDraft(INVOICE(), RECIPIENT);
  assert.equal(result.created === false && result.uncertain, true);
});
