import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePaymentSchedule } from '../buildsuite/payment-schedule.ts';
import { composeFirstInvoice, type InvoiceContext, type InvoiceRecipient } from './invoice.ts';
import { buildGhlInvoicePayload, createGhlInvoiceRail } from './ghl-rail.ts';

const SCHEDULE = parsePaymentSchedule({
  payment_schedule: [
    {
      amount: 1773.75,
      trigger: 'Due upon signed contract',
      milestone: 'Contract Signing & Scheduling',
      percentage: 30,
    },
  ],
});
const CTX: InvoiceContext = { projectCode: 'BSA-044', clientName: 'Dana Johnson' };
const RECIPIENT: InvoiceRecipient = {
  ghlContactId: 'f1zrPKs0KMb7cHQ5267x',
  name: 'Dana Johnson',
  email: 'dana@example.com',
};
const ISSUE = new Date('2026-09-05T00:00:00Z');

test('the payload matches the real GHL shape, with an ad-hoc line item', () => {
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const p = buildGhlInvoicePayload(draft, RECIPIENT, {
    locationId: 'IifYfP2B2NUaoDPdsTTa',
    businessName: 'Alliance For Contractors',
    issue: ISSUE,
    dueInDays: 5,
  });

  assert.equal(p.altId, 'IifYfP2B2NUaoDPdsTTa');
  assert.equal(p.altType, 'location');
  assert.equal(p.currency, 'USD');
  assert.equal(p.title, 'INVOICE');
  assert.equal(p.name, 'BSA-044 · Invoice 1 of 1'); // the project code rides along
  assert.equal(p.contactDetails.id, 'f1zrPKs0KMb7cHQ5267x');
  assert.equal(p.invoiceItems.length, 1);
  assert.equal(p.invoiceItems[0]!.name, 'Contract Signing & Scheduling');
  assert.equal(p.invoiceItems[0]!.amount, 1773.75);
  assert.equal(p.invoiceItems[0]!.qty, 1);
  assert.match(p.termsNotes, /Due upon signed contract/);
});

test('the due date is offset from the issue date', () => {
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const p = buildGhlInvoicePayload(draft, RECIPIENT, {
    locationId: 'L', businessName: 'B', issue: ISSUE, dueInDays: 5,
  });
  assert.equal(p.issueDate, '2026-09-05');
  assert.equal(p.dueDate, '2026-09-10');
});

test('sentTo carries the recipient email, ready for a person to send from GHL', () => {
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const p = buildGhlInvoicePayload(draft, RECIPIENT, {
    locationId: 'L', businessName: 'B', issue: ISSUE, dueInDays: 5,
  });
  assert.deepEqual(p.sentTo.email, ['dana@example.com']);
});

test('createDraft POSTs to /invoices/ and returns the created id, never a send', async () => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ _id: 'inv_new_123' }), { status: 200 });
  }) as unknown as typeof fetch;

  const rail = createGhlInvoiceRail({
    token: 'pit-test', locationId: 'IifYfP2B2NUaoDPdsTTa', fetchImpl: fakeFetch,
  });
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const result = await rail.createDraft(draft, RECIPIENT);

  assert.equal(result.created, true);
  assert.equal(result.created && result.externalId, 'inv_new_123');
  // Exactly one call, and it is the create — no send endpoint is ever hit.
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/invoices\/$/);
  assert.equal(calls[0]!.method, 'POST');
  assert.ok(!calls.some((c) => /\/send/.test(c.url)), 'the rail must never call the send endpoint');
});

test('createDraft refuses a draft with no amount, before any network call', async () => {
  let called = false;
  const fakeFetch = (async () => {
    called = true;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;

  const rail = createGhlInvoiceRail({ token: 't', locationId: 'L', fetchImpl: fakeFetch });
  const noAmount = composeFirstInvoice(
    parsePaymentSchedule({ payment_schedule: [{ milestone: 'X', percentage: 10 }] }),
    CTX,
  )!;
  const result = await rail.createDraft(noAmount, RECIPIENT);

  assert.equal(result.created, false);
  assert.equal(called, false, 'it must not reach GHL with a malformed draft');
});

test('createDraft refuses when the project code is still pending', async () => {
  const rail = createGhlInvoiceRail({ token: 't', locationId: 'L', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch });
  const pending = composeFirstInvoice(SCHEDULE, { projectCode: null, clientName: 'Dana' })!;
  const result = await rail.createDraft(pending, RECIPIENT);
  assert.equal(result.created, false);
  assert.match(result.created === false ? result.reason : '', /code/i);
});

test('createDraft refuses a recipient with no contact id or email', async () => {
  const rail = createGhlInvoiceRail({ token: 't', locationId: 'L', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch });
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const result = await rail.createDraft(draft, { ghlContactId: '', name: 'X', email: '' });
  assert.equal(result.created, false);
});

test('a GHL error is reported without echoing the response body wholesale', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ message: 'Bearer pit-secret leaked here' }), { status: 422 })) as unknown as typeof fetch;
  const rail = createGhlInvoiceRail({ token: 'pit-secret', locationId: 'L', fetchImpl: fakeFetch });
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const result = await rail.createDraft(draft, RECIPIENT);

  assert.equal(result.created, false);
  const reason = result.created === false ? result.reason : '';
  assert.match(reason, /HTTP 422/);
  assert.ok(!reason.includes('pit-secret'), 'the error must not carry the token or raw body');
});

test('a network failure is caught, not thrown', async () => {
  const fakeFetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const rail = createGhlInvoiceRail({ token: 't', locationId: 'L', fetchImpl: fakeFetch });
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const result = await rail.createDraft(draft, RECIPIENT);
  assert.equal(result.created, false);
  assert.match(result.created === false ? result.reason : '', /could not reach GHL/);
});

test('an id nested under invoice is still found', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ invoice: { _id: 'nested_999' } }), { status: 201 })) as unknown as typeof fetch;
  const rail = createGhlInvoiceRail({ token: 't', locationId: 'L', fetchImpl: fakeFetch });
  const draft = composeFirstInvoice(SCHEDULE, CTX)!;
  const result = await rail.createDraft(draft, RECIPIENT);
  assert.equal(result.created && result.externalId, 'nested_999');
});
