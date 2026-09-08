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
