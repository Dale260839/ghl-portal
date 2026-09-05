/**
 * BuildSuite Supabase reader.
 *
 * The load-bearing tests here are the read-only ones. D-003 says never alter that
 * database, and the read key we were given permits more than it should (D-010) —
 * so "we won't write" needs to be a property of the code, not a promise.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BuildSuiteClient, BuildSuiteReadError, readBuildSuiteConfig } from './client.ts';
import { PROJECT_COLUMNS, normalizeProject, type BuildSuiteProjectRow } from './projects.ts';

const config = { url: 'https://example.supabase.co', key: 'sb_publishable_test' };

function clientWith(response: Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return response;
  }) as unknown as typeof fetch;
  return { client: new BuildSuiteClient(config, { fetchImpl }), calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

// ── D-003: read-only is structural ───────────────────────────────────────────

test('D-003 every request is a GET — there is no other verb', async () => {
  const { client, calls } = clientWith(json([]));
  await client.select({ from: 'projects', columns: ['id'] });
  assert.equal(calls[0]!.init.method, 'GET');
});

test('D-003 the client exposes no write method at all', () => {
  const surface = Object.getOwnPropertyNames(BuildSuiteClient.prototype);
  assert.deepEqual(surface.sort(), ['constructor', 'count', 'select']);
  for (const forbidden of ['insert', 'update', 'upsert', 'delete', 'rpc', 'post', 'patch']) {
    assert.equal(
      (client => forbidden in client)(BuildSuiteClient.prototype as unknown as object),
      false,
      `${forbidden} must not exist on the client`,
    );
  }
});

test('select(*) is refused — columns must be named', async () => {
  const { client } = clientWith(json([]));
  await assert.rejects(() => client.select({ from: 'projects', columns: ['*'] }), /not allowed/);
  await assert.rejects(() => client.select({ from: 'projects', columns: [] }), /explicit/);
});

test('the narrow select never asks for PII we have no screen for', () => {
  // D-010: the key permits reading these. Not asking is our half of that.
  for (const forbidden of ['client_email', 'client_phone', 'scope', 'sow_data', 'documents']) {
    assert.ok(
      !(PROJECT_COLUMNS as readonly string[]).includes(forbidden),
      `${forbidden} must not be selected`,
    );
  }
});

// ── Request shape ────────────────────────────────────────────────────────────

test('both auth headers are sent — PostgREST needs apikey and Authorization', async () => {
  const { client, calls } = clientWith(json([]));
  await client.select({ from: 'projects', columns: ['id'] });
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.apikey, config.key);
  assert.equal(headers.Authorization, `Bearer ${config.key}`);
});

test('filters, order and limit are serialized as PostgREST expects', async () => {
  const { client, calls } = clientWith(json([]));
  await client.select({
    from: 'projects',
    columns: ['id', 'title'],
    filters: { status: 'eq.active' },
    order: 'updated_at.desc',
    limit: 25,
  });
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, '/rest/v1/projects');
  assert.equal(url.searchParams.get('select'), 'id,title');
  assert.equal(url.searchParams.get('status'), 'eq.active');
  assert.equal(url.searchParams.get('order'), 'updated_at.desc');
  assert.equal(url.searchParams.get('limit'), '25');
});

test('count reads the total from Content-Range without transferring rows', async () => {
  const response = new Response('[]', {
    status: 206,
    headers: { 'content-range': '0-0/43' },
  });
  const { client, calls } = clientWith(response);
  assert.equal(await client.count('projects', { status: 'eq.active' }), 43);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Prefer, 'count=exact');
  assert.equal(headers.Range, '0-0');
});

// ── Errors ───────────────────────────────────────────────────────────────────

test('a 401 is not retryable — a bad key stays bad', async () => {
  const { client } = clientWith(json({ message: 'unauthorized' }, { status: 401 }));
  await assert.rejects(
    () => client.select({ from: 'projects', columns: ['id'] }),
    (e: unknown) => e instanceof BuildSuiteReadError && !e.retryable && e.status === 401,
  );
});

test('a 5xx is retryable', async () => {
  const { client } = clientWith(json({}, { status: 503 }));
  await assert.rejects(
    () => client.select({ from: 'projects', columns: ['id'] }),
    (e: unknown) => e instanceof BuildSuiteReadError && e.retryable,
  );
});

test('config reports which vars are missing rather than throwing', () => {
  const result = readBuildSuiteConfig({} as NodeJS.ProcessEnv);
  assert.equal(result.configured, false);
  assert.deepEqual(result.configured === false ? result.missing : [], [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
  ]);
});

// ── Normalization ────────────────────────────────────────────────────────────

const row: BuildSuiteProjectRow = {
  id: '7b9eefb9-41d2-424a-8885-68ac4f941454',
  project_code: null,
  title: 'mike kitchen',
  status: 'active',
  source: 'contractor',
  created_at: '2026-06-20T19:20:02.228121+00:00',
  updated_at: '2026-06-21T10:00:00.000000+00:00',
  street_address: '1400 Broadway',
  city: 'San Antonio',
  state: 'TX',
  postal_code: '78215',
  trade: 'Remodeling',
  project_type: 'kitchen_remodel',
  budget_band: '$25k–$50k',
  exact_budget: 48500,
  start_date: null,
  end_date: null,
  client_name: 'Dana Johnson',
  ghl_contact_id: 'ghl_contact_abc',
  ghl_opportunity_id: 'ghl_opp_xyz',
  auth_profile_id: '1dca7b15-9904-449b-a702-5725a5d1b069',
};

test('normalization joins the address and formats the budget', () => {
  const project = normalizeProject(row);
  assert.equal(project.address, '1400 Broadway, San Antonio, TX, 78215');
  assert.equal(project.budget, '$48,500');
});

test('exact budget wins over the band, and the band is the fallback', () => {
  assert.equal(normalizeProject({ ...row, exact_budget: null }).budget, '$25k–$50k');
  assert.equal(normalizeProject({ ...row, exact_budget: null, budget_band: null }).budget, '—');
});

test('a partial address does not produce stray commas', () => {
  const sparse = normalizeProject({
    ...row,
    street_address: null,
    city: 'San Antonio',
    state: 'TX',
    postal_code: null,
  });
  assert.equal(sparse.address, 'San Antonio, TX');
});

test('D-010 linkedToGhl reflects ghl_opportunity_id, the actual join key', () => {
  assert.equal(normalizeProject(row).linkedToGhl, true);
  assert.equal(normalizeProject({ ...row, ghl_opportunity_id: null }).linkedToGhl, false);
  assert.equal(normalizeProject({ ...row, ghl_opportunity_id: '' }).linkedToGhl, false);
});

test('nulls normalize to placeholders rather than crashing a screen', () => {
  const empty = normalizeProject({
    ...row,
    title: null,
    status: null,
    source: null,
    trade: null,
    project_type: null,
    client_name: null,
  });
  assert.equal(empty.title, 'Untitled project');
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.trade, '—');
  assert.equal(empty.clientName, '—');
});
