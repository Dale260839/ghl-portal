/**
 * Invoices from GoHighLevel.
 *
 * Two things here can cost somebody money if they are wrong: what a homeowner
 * is shown, and the arithmetic. Both are tested from the direction of the
 * mistake rather than the happy path.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GhlInvoiceError,
  GhlInvoices,
  forClient,
  isIssued,
  normalizeInvoice,
  totalInvoices,
  type Invoice,
} from './invoices.ts';

const CONFIG = {
  baseUrl: 'https://ghl.example',
  apiVersion: '2021-07-28',
  token: 'test-token',
  locationId: 'loc-1',
  projectObjectKey: '',
};

function row(over: Record<string, unknown> = {}) {
  return {
    _id: 'inv-1',
    invoiceNumber: '000193',
    status: 'sent',
    title: 'Deposit',
    currency: 'USD',
    total: 998,
    amountPaid: 0,
    issueDate: '2026-07-25T00:00:00Z',
    dueDate: '2026-08-08T00:00:00Z',
    contactDetails: { id: 'contact-1', name: 'Uriel Ortiz', email: 'u@example.com' },
    invoiceItems: [{ name: 'Deposit', qty: 1, amount: 998 }],
    ...over,
  };
}

const invoice = (over: Record<string, unknown> = {}): Invoice => normalizeInvoice(row(over));

// ── What a homeowner must never receive ─────────────────────────────────────

test('the client projection drops the contractor fields entirely', () => {
  // Dropped, not blanked. A response that carries `contactName: ""` can still
  // be rendered by a future screen; one with no such property cannot.
  const client = forClient(invoice());

  assert.equal('contactId' in client, false);
  assert.equal('contactName' in client, false);
  assert.equal(JSON.stringify(client).includes('Uriel Ortiz'), false);
});

test('the projection keeps what a homeowner legitimately needs', () => {
  const client = forClient(invoice());

  assert.equal(client.invoiceNumber, '000193');
  assert.equal(client.total, 998);
  assert.equal(client.amountDue, 998);
  assert.equal(client.dueDate, '2026-08-08T00:00:00Z');
  assert.deepEqual(client.items, [{ name: 'Deposit', quantity: 1, amount: 998 }]);
});

test('a draft is not an issued invoice', () => {
  // A draft is the contractor still deciding. Showing a homeowner a figure
  // nobody issued starts an argument about a price that was never quoted.
  assert.equal(isIssued(invoice({ status: 'draft' })), false);
  assert.equal(isIssued(invoice({ status: 'void' })), false);
  assert.equal(isIssued(invoice({ status: 'sent' })), true);
  assert.equal(isIssued(invoice({ status: 'paid' })), true);
});

test('an unrecognised status is treated as issued, not hidden', () => {
  // GHL can add statuses. Hiding an invoice we do not recognise means a
  // homeowner is not told about money they owe, which is the worse failure.
  assert.equal(isIssued(invoice({ status: 'partially_paid' })), true);
  assert.equal(invoice({ status: null }).status, 'unknown');
});

// ── The arithmetic ──────────────────────────────────────────────────────────

test('amountDue is derived when GHL omits it, not defaulted to zero', () => {
  // A missing balance shown as nothing owed is the wrong direction for this
  // number to be wrong.
  const missing = normalizeInvoice(row({ total: 1000, amountPaid: 250, amountDue: undefined }));
  assert.equal(missing.amountDue, 750);

  // And GHL's own figure wins when it sends one, including a legitimate zero.
  assert.equal(normalizeInvoice(row({ total: 1000, amountPaid: 1000, amountDue: 0 })).amountDue, 0);
});

test('a negative balance is never shown as owed', () => {
  // An overpayment is a refund conversation, not a debt.
  assert.equal(normalizeInvoice(row({ total: 100, amountPaid: 150, amountDue: undefined })).amountDue, 0);
});

test('totals exclude drafts', () => {
  const totals = totalInvoices([
    invoice({ _id: 'a', status: 'sent', total: 998, amountPaid: 0 }),
    invoice({ _id: 'b', status: 'paid', total: 999, amountPaid: 999 }),
    invoice({ _id: 'c', status: 'draft', total: 5000, amountPaid: 0 }),
  ]);

  assert.equal(totals.invoiced, 1997, 'the 5000 draft must not be counted');
  assert.equal(totals.paid, 999);
  assert.equal(totals.outstanding, 998);
});

test('overdue is separate from outstanding, and only counts what is late', () => {
  // "You owe money" and "you are late" are different conversations.
  const today = new Date('2026-08-20T00:00:00Z');
  const totals = totalInvoices(
    [
      invoice({ _id: 'late', total: 500, amountPaid: 0, dueDate: '2026-08-08T00:00:00Z' }),
      invoice({ _id: 'soon', total: 300, amountPaid: 0, dueDate: '2026-09-30T00:00:00Z' }),
      invoice({ _id: 'settled', status: 'paid', total: 200, amountPaid: 200, dueDate: '2026-01-01T00:00:00Z' }),
    ],
    today,
  );

  assert.equal(totals.outstanding, 800, 'both unpaid invoices');
  assert.equal(totals.overdue, 500, 'only the one past its date');
});

test('an invoice with no due date is never overdue', () => {
  const totals = totalInvoices([invoice({ total: 400, amountPaid: 0, dueDate: undefined })], new Date());

  assert.equal(totals.outstanding, 400);
  assert.equal(totals.overdue, 0);
});

test('an empty list totals to zeros rather than NaN', () => {
  const totals = totalInvoices([]);

  assert.equal(totals.invoiced, 0);
  assert.equal(totals.overdue, 0);
  assert.equal(totals.currency, 'USD');
});

// ── The reader ──────────────────────────────────────────────────────────────

function fake(response: unknown, status = 200) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { urls, reader: new GhlInvoices(CONFIG, fetchImpl) };
}

test('the list request always carries an offset', () => {
  // GHL answers 422 without it, and the message reads like a permissions
  // problem rather than a missing parameter. That cost half an hour once.
  const { reader, urls } = fake({ invoices: [] });

  return reader.list().then(() => {
    assert.match(urls[0]!, /offset=0/);
    assert.match(urls[0]!, /altId=loc-1/);
    assert.match(urls[0]!, /altType=location/);
  });
});

test('a failed request reports the status rather than returning nothing', async () => {
  // An empty invoice list and a broken billing system look identical on a
  // screen, and only one of them means "you owe nothing".
  const { reader } = fake({ message: 'nope' }, 401);

  await assert.rejects(() => reader.list(), GhlInvoiceError);
});

test('a contact lookup with no id never reaches the network', async () => {
  const { reader, urls } = fake({ invoices: [] });

  assert.deepEqual(await reader.forContact(''), []);
  assert.deepEqual(urls, []);
});

test('a contact lookup returns only that contact’s invoices', async () => {
  const { reader } = fake({
    invoices: [
      row({ _id: 'mine', contactDetails: { id: 'contact-1' } }),
      row({ _id: 'theirs', contactDetails: { id: 'contact-2' } }),
    ],
  });

  const mine = await reader.forContact('contact-1');
  assert.deepEqual(mine.map((i) => i.id), ['mine']);
});

// ── The live shape ──────────────────────────────────────────────────────────

test('the real Alliance invoice set reproduces', () => {
  // Measured 2026-09-01 against the live sub-account: 8 invoices, 2 of them
  // drafts, $7,547.10 issued and $1,997 outstanding.
  const live = [
    invoice({ _id: '1', status: 'sent', total: 998, amountPaid: 0 }),
    invoice({ _id: '2', status: 'paid', total: 998, amountPaid: 998 }),
    invoice({ _id: '3', status: 'paid', total: 999, amountPaid: 999 }),
    invoice({ _id: '4', status: 'sent', total: 999, amountPaid: 0 }),
    invoice({ _id: '5', status: 'paid', total: 797.4, amountPaid: 797.4 }),
    invoice({ _id: '6', status: 'draft', total: 1000, amountPaid: 0 }),
    invoice({ _id: '7', status: 'draft', total: 3348.02, amountPaid: 0 }),
    invoice({ _id: '8', status: 'paid', total: 2755.7, amountPaid: 2755.7 }),
  ];

  const totals = totalInvoices(live);
  assert.equal(live.filter(isIssued).length, 6);
  assert.equal(Math.round(totals.invoiced * 100) / 100, 7547.1);
  assert.equal(Math.round(totals.paid * 100) / 100, 5550.1);
  assert.equal(totals.outstanding, 1997);
});
