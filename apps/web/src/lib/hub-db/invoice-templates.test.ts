import assert from 'node:assert/strict';
import test from 'node:test';

import { HubClient } from './client.ts';
import { HubInvoiceTemplates } from './invoice-templates.ts';
import { EMPTY_TEMPLATE } from '../invoicing/template.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

/**
 * `hub_invoice_templates` — one per contractor, and only ever their own.
 */

const scope: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['ap-1'],
  contractorId: 'contractor-A',
};

function fake(responses: unknown[] = [[]]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url: decodeURIComponent(String(url)),
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const client = new HubClient({ url: 'https://hub.example', key: 'k' }, { fetchImpl });
  return { calls, templates: new HubInvoiceTemplates(client) };
}

const ROW = {
  id: 't1',
  contractor_id: 'contractor-A',
  business_name: 'APS',
  logo_url: 'https://cdn.example.com/aps.png',
  phone: null,
  website: null,
  address: null,
  standing_terms: 'Checks payable to APS.',
  due_in_days: 14,
  updated_at: '2026-09-12T00:00:00Z',
  updated_by: 'Dale',
};

test('reading filters on the contractor from the scope', async () => {
  const { templates, calls } = fake([[ROW]]);
  const t = await templates.getForContractor(scope);

  assert.match(calls[0]!.url, /hub_invoice_templates\?.*contractor_id=eq\.contractor-A/);
  assert.equal(t?.businessName, 'APS');
  assert.equal(t?.dueInDays, 14);
});

test('an account that never saved one reads as null, not as an error', async () => {
  const { templates } = fake([[]]);
  assert.equal(await templates.getForContractor(scope), null);
});

test('saving writes the contractor id from the SCOPE, never from the form', async () => {
  // A form could post any contractor id. The row's owner comes from the
  // asserted scope, so one contractor cannot overwrite another's letterhead.
  const { templates, calls } = fake([[ROW]]);
  await templates.save(scope, { ...EMPTY_TEMPLATE, businessName: 'APS' }, { name: 'Dale' });

  const post = calls.find((c) => c.method === 'POST')!;
  assert.match(post.url, /on_conflict=contractor_id/);
  const [row] = post.body as Record<string, unknown>[];
  assert.equal(row!.contractor_id, 'contractor-A');
  assert.equal(row!.updated_by, 'Dale');
});

test('one template per account: saving again replaces, never duplicates', async () => {
  const { templates, calls } = fake([[ROW]]);
  await templates.save(scope, EMPTY_TEMPLATE, { name: 'Dale' });
  const post = calls.find((c) => c.method === 'POST')!;
  assert.match(post.url, /on_conflict=contractor_id/, 'must upsert on the contractor');
});

test('without a resolved contractor, nothing is read or written', async () => {
  // Nine of the sixty-eight accounts on this location resolve to no contractor.
  // They get no template rather than somebody else's.
  const { templates, calls } = fake();
  const unlinked = { locationId: 'loc-1', authProfileIds: ['ap-1'] } as TenantScope;

  await assert.rejects(() => templates.getForContractor(unlinked), TenancyError);
  await assert.rejects(() => templates.save(unlinked, EMPTY_TEMPLATE, { name: 'x' }), TenancyError);
  assert.deepEqual(calls, []);
});
