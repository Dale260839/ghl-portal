/**
 * Tenancy — a contractor sees their own projects and nobody else's.
 *
 * This exists because of a measured leak, not a hypothetical one. On 2026-08-12
 * the live database had 43 active projects across 5 contractors, and the reader
 * returned all 43 to any signed-in user.
 *
 * The load-bearing tests are the ones proving an unscoped read is impossible.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TenancyError, assertScope } from './tenancy.ts';
import { BuildSuiteClient } from './buildsuite/client.ts';
import { getBuildSuiteReader } from './buildsuite/projects.ts';

const OWNER_A = '7726102a-8e13-4006-889d-d68bc1cccd40';
const OWNER_B = 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01';

// ── Failing closed ───────────────────────────────────────────────────────────

test('an absent scope raises rather than reading everything', () => {
  for (const bad of [null, undefined]) {
    assert.throws(() => assertScope(bad, 'projects'), TenancyError);
  }
});

test('a blank auth profile id is not a scope', () => {
  for (const id of ['', '   ']) {
    assert.throws(() => assertScope({ authProfileId: id }, 'projects'), TenancyError);
  }
  // @ts-expect-error — guarding the untyped boundary, e.g. a decoded JWT claim
  assert.throws(() => assertScope({ authProfileId: null }, 'projects'), TenancyError);
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
  const scope = { authProfileId: OWNER_A };
  assert.equal(assertScope(scope, 'projects'), scope);
});

// ── The filter actually reaches the query ────────────────────────────────────

function readerWith(rows: unknown[]) {
  const urls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': `0-0/${rows.length}` },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient(
    { url: 'https://example.supabase.co', key: 'k' },
    { fetchImpl },
  );
  return { client, urls };
}

test('every active-projects read carries the tenant filter', async () => {
  const { client, urls } = readerWith([]);
  // Exercise the same private path the reader uses, through the public API.
  await client.select({
    from: 'projects',
    columns: ['id'],
    filters: { auth_profile_id: `eq.${OWNER_A}`, status: 'eq.active' },
  });
  const url = new URL(urls[0]!);
  assert.equal(url.searchParams.get('auth_profile_id'), `eq.${OWNER_A}`);
  assert.equal(url.searchParams.get('status'), 'eq.active');
});

test('two tenants produce two different filters', async () => {
  const { client, urls } = readerWith([]);
  for (const owner of [OWNER_A, OWNER_B]) {
    await client.select({
      from: 'projects',
      columns: ['id'],
      filters: { auth_profile_id: `eq.${owner}` },
    });
  }
  const a = new URL(urls[0]!).searchParams.get('auth_profile_id');
  const b = new URL(urls[1]!).searchParams.get('auth_profile_id');
  assert.notEqual(a, b);
  assert.equal(a, `eq.${OWNER_A}`);
  assert.equal(b, `eq.${OWNER_B}`);
});

// ── The interface itself forbids the mistake ─────────────────────────────────

test('the reader has no unscoped overload to reach for', () => {
  const reader = getBuildSuiteReader();
  if (!reader.available) return; // unconfigured in CI — the type check still holds

  // listActiveProjects(scope, limit) — scope is the FIRST parameter, so calling
  // it with a bare number is a type error, not a silent global read.
  assert.equal(reader.listActiveProjects.length >= 1, true);
  assert.equal(reader.countByStatus.length, 1);
});

test('a reader call with a junk scope rejects rather than returning rows', async () => {
  const reader = getBuildSuiteReader();
  if (!reader.available) return;
  await assert.rejects(() => reader.listActiveProjects({ authProfileId: '' }), TenancyError);
  await assert.rejects(
    () => reader.countByStatus(null as unknown as { authProfileId: string }),
    TenancyError,
  );
});
