/**
 * The contractor's own details, as an invoice prints them.
 *
 * Chris asked (10 Sep) for an invoice that looks like a proper invoice: the
 * contractor's logo at the top and their contact details under it. These tests
 * cover the two ways that goes wrong quietly — a logo column holding a file
 * name rather than a URL, which renders as a broken image on a document a
 * homeowner reads, and a half-filled address printing stray commas.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BuildSuiteClient } from './client.ts';
import { ContractorResolver } from './contractor-identity.ts';
import type { TenantScope } from '../tenancy.ts';

const scope: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
};

/** Responses are served in order: the auth profile lookup, then the contractor. */
function fake(responses: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    // D-003: this database is production and the client can only ever GET.
    assert.equal(init?.method ?? 'GET', 'GET');
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient({ url: 'https://bs.example', key: 'k' }, { fetchImpl });
  return { urls, resolver: new ContractorResolver(client) };
}

const PROFILE_ROW = {
  business_name: 'Example Builders',
  full_name: 'Sam Example',
  business_logo_url: 'https://cdn.example/logo.png',
  business_logo: null,
  phone: '+1 555 0100',
  website: 'https://example.test',
  street_address: '12 Mill Road',
  city: 'Austin',
  state: 'TX',
  postal_code: '78701',
  email: 'billing@example.test',
};

const LINKED = [{ id: 'p1', contractor_id: 'c1', contact_id: null, email: null }];

test('the profile reads only this contractor row, and joins the address', async () => {
  const { resolver, urls } = fake([LINKED, [PROFILE_ROW]]);

  const profile = await resolver.profile(scope);

  assert.deepEqual(profile, {
    businessName: 'Example Builders',
    logoUrl: 'https://cdn.example/logo.png',
    phone: '+1 555 0100',
    website: 'https://example.test',
    address: '12 Mill Road, Austin, TX, 78701',
    email: 'billing@example.test',
  });
  // Filtered on the resolved contractor id, never on a name.
  assert.match(urls[1]!, /contractors\?/);
  assert.match(urls[1]!, /id=eq\.c1/);
  // Never `*`: the key grants more than it should.
  assert.ok(!urls[1]!.includes('select=*'));
});

test('a logo that is not an http URL is dropped rather than rendered', async () => {
  // Both logo columns hold a mix of URLs and stored file names on live data.
  // A file name in an <img> is a broken image on an invoice.
  const { resolver } = fake([
    LINKED,
    [{ ...PROFILE_ROW, business_logo_url: 'logo-final-v2.png', business_logo: '  ' }],
  ]);

  const profile = await resolver.profile(scope);
  assert.equal(profile?.logoUrl, null);
});

test('the second logo column is used when the first is empty', async () => {
  const { resolver } = fake([
    LINKED,
    [{ ...PROFILE_ROW, business_logo_url: null, business_logo: 'https://cdn.example/alt.png' }],
  ]);

  const profile = await resolver.profile(scope);
  assert.equal(profile?.logoUrl, 'https://cdn.example/alt.png');
});

test('blank parts of the address are dropped, not printed as commas', async () => {
  const { resolver } = fake([
    LINKED,
    [{ ...PROFILE_ROW, street_address: null, state: '  ', postal_code: '' }],
  ]);

  const profile = await resolver.profile(scope);
  assert.equal(profile?.address, 'Austin');
});

test('an entirely blank row gives nulls, never empty strings', async () => {
  const { resolver } = fake([
    LINKED,
    [{
      business_name: '  ',
      full_name: null,
      business_logo_url: null,
      business_logo: null,
      phone: '',
      website: null,
      street_address: null,
      city: null,
      state: null,
      postal_code: null,
      email: null,
    }],
  ]);

  assert.deepEqual(await resolver.profile(scope), {
    businessName: null,
    logoUrl: null,
    phone: null,
    website: null,
    address: null,
    email: null,
  });
});

test('the business name falls back to the person when there is no company', async () => {
  const { resolver } = fake([LINKED, [{ ...PROFILE_ROW, business_name: null }]]);
  const profile = await resolver.profile(scope);
  assert.equal(profile?.businessName, 'Sam Example');
});

test('an unlinked session gets no profile, rather than somebody else’s', async () => {
  // The whole point of the resolver: unresolved means nothing, not everything.
  const { resolver } = fake([[], []]);
  assert.equal(await resolver.profile(scope), null);
});

test('the profile is cached per contractor, like the name is', async () => {
  const { resolver, urls } = fake([LINKED, [PROFILE_ROW]]);

  await resolver.profile(scope);
  const before = urls.length;
  await resolver.profile(scope);

  assert.equal(urls.length, before, 'a second read must come from the cache');
});
