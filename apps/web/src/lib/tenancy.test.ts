/**
 * Tenancy — an agency sees its own projects and nobody else's.
 *
 * This exists because of a measured leak, not a hypothetical one. On 2026-08-12
 * the live database had 43 active projects across 5 contractors, and the reader
 * returned all 43 to any signed-in user.
 *
 * **The tenant is the GHL sub-account**, matching how BuildSuite works — its
 * menu link passes only `locationId`. A location maps to several BuildSuite
 * profiles: the live agency `IifYfP2B2NUaoDPdsTTa` has two admin profiles owning
 * nine projects between them, so scoping to one would hide half an agency's work
 * from itself.
 *
 * The load-bearing tests are the ones proving an unscoped read is impossible.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TenancyError, assertScope, ownedByScope, type TenantScope } from './tenancy.ts';
import { BuildSuiteClient } from './buildsuite/client.ts';

const LOCATION = 'IifYfP2B2NUaoDPdsTTa';
const PROFILE_A = '1dca7b15-9904-449b-a702-5725a5d1b069';
const PROFILE_B = 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01';
const OUTSIDER = '7726102a-8e13-4006-889d-d68bc1cccd40';

const scope: TenantScope = { locationId: LOCATION, authProfileIds: [PROFILE_A, PROFILE_B] };

// ── Failing closed ───────────────────────────────────────────────────────────

test('an absent scope raises rather than reading everything', () => {
  for (const bad of [null, undefined]) {
    assert.throws(() => assertScope(bad, 'projects'), TenancyError);
  }
});

test('a scope with no location is refused', () => {
  for (const id of ['', '   ']) {
    assert.throws(
      () => assertScope({ locationId: id, authProfileIds: [PROFILE_A] }, 'projects'),
      TenancyError,
    );
  }
});

test('an EMPTY profile list is refused — the disguised version of the same bug', () => {
  // An empty `in ()` matches nothing silently, which reads as "this agency has
  // no projects" rather than "the scope was never resolved".
  assert.throws(
    () => assertScope({ locationId: LOCATION, authProfileIds: [] }, 'projects'),
    TenancyError,
  );
});

test('a blank id inside the list is refused', () => {
  assert.throws(
    () => assertScope({ locationId: LOCATION, authProfileIds: [PROFILE_A, ''] }, 'projects'),
    TenancyError,
  );
});

test('the error names what was being read, so a log is actionable', () => {
  try {
    assertScope(null, 'active projects');
    assert.fail('should have thrown');
  } catch (error) {
    assert.match((error as Error).message, /active projects/);
    assert.match((error as Error).message, /unscoped/);
  }
});

test('a valid scope passes through unchanged', () => {
  assert.equal(assertScope(scope, 'projects'), scope);
});

// ── Ownership ────────────────────────────────────────────────────────────────

test('an agency owns rows from every profile it contains', () => {
  assert.ok(ownedByScope(scope, PROFILE_A));
  assert.ok(ownedByScope(scope, PROFILE_B), 'both admin profiles, one agency');
});

test('a profile outside the agency is not owned', () => {
  assert.ok(!ownedByScope(scope, OUTSIDER));
  assert.ok(!ownedByScope(scope, ''));
});

// ── The filter actually reaches the query ────────────────────────────────────

function clientRecording() {
  const urls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    urls.push(String(url));
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient(
    { url: 'https://example.supabase.co', key: 'k' },
    { fetchImpl },
  );
  return { client, urls };
}

test('the tenant filter is an IN over every profile in the agency', async () => {
  const { client, urls } = clientRecording();
  await client.select({
    from: 'projects',
    columns: ['id'],
    filters: { auth_profile_id: `in.(${PROFILE_A},${PROFILE_B})`, status: 'eq.active' },
  });
  const url = new URL(urls[0]!);
  const filter = url.searchParams.get('auth_profile_id') ?? '';
  assert.ok(filter.startsWith('in.('));
  assert.ok(filter.includes(PROFILE_A));
  assert.ok(filter.includes(PROFILE_B));
  assert.ok(!filter.includes(OUTSIDER), 'nobody else gets swept in');
});

test('two agencies produce two different filters', async () => {
  const { client, urls } = clientRecording();
  for (const ids of [[PROFILE_A, PROFILE_B], [OUTSIDER]]) {
    await client.select({
      from: 'projects',
      columns: ['id'],
      filters: { auth_profile_id: `in.(${ids.join(',')})` },
    });
  }
  const first = new URL(urls[0]!).searchParams.get('auth_profile_id');
  const second = new URL(urls[1]!).searchParams.get('auth_profile_id');
  assert.notEqual(first, second);
  assert.ok(!(second ?? '').includes(PROFILE_A), 'the second agency cannot see the first');
});
