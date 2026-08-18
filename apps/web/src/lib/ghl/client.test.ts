/**
 * Transport behaviour — the parts that decide whether the unattended hourly
 * sync-back survives a bad afternoon. All tested with a fake fetch, so none of
 * it needs credentials or a network.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GhlClient, backoffMs } from './client.ts';
import { readGhlConfig } from './config.ts';
import { GhlAuthError, GhlNotFoundError, GhlRateLimitError } from './errors.ts';
import { FIELD_KEYS, mapProject } from './mapper.ts';

const config = {
  baseUrl: 'https://api.example.com',
  apiVersion: '2021-07-28',
  locationId: 'loc_123',
  token: 'tok_abc',
  projectObjectKey: 'custom_objects.projects',
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function clientWith(responses: Response[], onCall?: (url: string, init: RequestInit) => void) {
  const calls: { url: string; init: RequestInit }[] = [];
  const slept: number[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    onCall?.(String(url), init as RequestInit);
    const next = responses.shift();
    if (next === undefined) throw new Error('fake fetch ran out of responses');
    return next;
  }) as unknown as typeof fetch;

  const client = new GhlClient({
    config,
    fetchImpl,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { client, calls, slept };
}

// ── Config ───────────────────────────────────────────────────────────────────

test('config reports exactly which vars are missing rather than throwing', () => {
  const result = readGhlConfig({} as NodeJS.ProcessEnv);
  assert.equal(result.configured, false);
  assert.deepEqual(result.configured === false ? result.missing : [], [
    'GHL_API_BASE_URL',
    'GHL_API_VERSION',
    'GHL_LOCATION_ID',
    'GHL_PRIVATE_INTEGRATION_TOKEN',
    'GHL_PROJECT_OBJECT_KEY',
  ]);
});

test('config treats blank strings as missing and trims the trailing slash', () => {
  const result = readGhlConfig({
    GHL_API_BASE_URL: 'https://api.example.com/',
    GHL_API_VERSION: '2021-07-28',
    GHL_LOCATION_ID: 'loc_123',
    GHL_PRIVATE_INTEGRATION_TOKEN: '   ',
    GHL_PROJECT_OBJECT_KEY: 'custom_objects.projects',
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(result.configured, false);
  assert.deepEqual(
    result.configured === false ? result.missing : [],
    ['GHL_PRIVATE_INTEGRATION_TOKEN'],
  );
});

// ── Headers ──────────────────────────────────────────────────────────────────

test('every request carries the bearer token and the Version header', async () => {
  const { client, calls } = clientWith([json({ ok: true })]);
  await client.request({ path: '/objects/records' });

  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer tok_abc');
  assert.equal(headers.Version, '2021-07-28');
});

test('query params are serialized and undefined ones dropped', async () => {
  const { client, calls } = clientWith([json({ ok: true })]);
  await client.request({
    path: '/objects/records',
    query: { locationId: 'loc_123', limit: 50, cursor: undefined },
  });

  const url = new URL(calls[0]!.url);
  assert.equal(url.searchParams.get('locationId'), 'loc_123');
  assert.equal(url.searchParams.get('limit'), '50');
  assert.equal(url.searchParams.has('cursor'), false);
});

// ── Retry policy ─────────────────────────────────────────────────────────────

test('5xx retries and eventually succeeds', async () => {
  const { client, calls } = clientWith([
    json({ error: 'boom' }, { status: 503 }),
    json({ error: 'boom' }, { status: 503 }),
    json({ value: 'ok' }),
  ]);

  const result = await client.request<{ value: string }>({ path: '/x' });
  assert.equal(result.value, 'ok');
  assert.equal(calls.length, 3);
});

test('429 waits for Retry-After rather than guessing', async () => {
  const { client, slept } = clientWith([
    json({}, { status: 429, headers: { 'retry-after': '2' } }),
    json({ value: 'ok' }),
  ]);

  await client.request({ path: '/x' });
  assert.deepEqual(slept, [2000]);
});

test('429 past the retry budget throws a typed, retryable error', async () => {
  const { client } = clientWith([
    json({}, { status: 429 }),
    json({}, { status: 429 }),
    json({}, { status: 429 }),
    json({}, { status: 429 }),
  ]);

  await assert.rejects(
    () => client.request({ path: '/x' }),
    (error: unknown) => error instanceof GhlRateLimitError && error.retryable,
  );
});

test('401 does NOT retry — a bad token stays bad', async () => {
  const { client, calls } = clientWith([json({}, { status: 401 })]);
  await assert.rejects(() => client.request({ path: '/x' }), GhlAuthError);
  assert.equal(calls.length, 1, 'retrying an auth failure only burns rate limit');
});

test('400 does NOT retry — a malformed request stays malformed', async () => {
  const { client, calls } = clientWith([json({ message: 'bad field' }, { status: 400 })]);
  await assert.rejects(() => client.request({ path: '/x' }));
  assert.equal(calls.length, 1);
});

test('404 raises a not-found naming what was fetched', async () => {
  const { client } = clientWith([json({}, { status: 404 })]);
  await assert.rejects(
    () => client.request({ path: '/x', describe: 'project BSP-2026-000184' }),
    (error: unknown) =>
      error instanceof GhlNotFoundError && error.message.includes('BSP-2026-000184'),
  );
});

test('network failure retries, then surfaces as retryable', async () => {
  let calls = 0;
  const client = new GhlClient({
    config,
    fetchImpl: (async () => {
      calls++;
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch,
    sleep: async () => {},
    maxRetries: 2,
  });

  await assert.rejects(() => client.request({ path: '/x' }));
  assert.equal(calls, 3, 'initial attempt plus two retries');
});

test('204 resolves without trying to parse a body', async () => {
  const { client } = clientWith([new Response(null, { status: 204 })]);
  assert.equal(await client.request({ path: '/x', method: 'DELETE' }), undefined);
});

test('backoff is jittered and capped', () => {
  // Full jitter: with random() at its maximum the value is the ceiling, and the
  // ceiling never exceeds the cap however many attempts have failed.
  assert.equal(backoffMs(0, () => 1), 400);
  assert.equal(backoffMs(1, () => 1), 800);
  assert.equal(backoffMs(99, () => 1), 8000);
  assert.equal(backoffMs(3, () => 0), 0);
  // Jitter must actually vary, otherwise every project retries in lockstep.
  assert.notEqual(backoffMs(3, () => 0.1), backoffMs(3, () => 0.9));
});

// ── Mapper ───────────────────────────────────────────────────────────────────

test('mapper reads fields from properties', () => {
  const project = mapProject({
    id: 'rec_1',
    properties: {
      [FIELD_KEYS.buildsuiteProjectId]: 'BSP-2026-000184',
      [FIELD_KEYS.projectName]: 'Johnson Kitchen Remodel',
      [FIELD_KEYS.progressPercentage]: 62,
      [FIELD_KEYS.projectStage]: 'In Progress',
      [FIELD_KEYS.clientPortalEnabled]: true,
    },
  });

  assert.equal(project.buildsuiteProjectId, 'BSP-2026-000184');
  assert.equal(project.projectName, 'Johnson Kitchen Remodel');
  assert.equal(project.progressPercentage, 62);
  assert.equal(project.projectStage, 'In Progress');
  assert.equal(project.clientPortalEnabled, true);
});

test('mapper also reads fields at the record root', () => {
  const project = mapProject({
    [FIELD_KEYS.projectName]: 'Root Level',
    [FIELD_KEYS.progressPercentage]: '41',
  });
  assert.equal(project.projectName, 'Root Level');
  assert.equal(project.progressPercentage, 41, 'numeric strings coerce');
});

test('checkboxes coerce from every shape GHL might send', () => {
  for (const truthy of [true, 'true', 'TRUE', 'yes', 1, '1']) {
    const p = mapProject({ properties: { [FIELD_KEYS.showBudgetToClient]: truthy } });
    assert.equal(p.showBudgetToClient, true, `${String(truthy)} should be true`);
  }
  for (const falsy of [false, 'false', 'no', 0, '0', '', null, undefined]) {
    const p = mapProject({ properties: { [FIELD_KEYS.showBudgetToClient]: falsy } });
    assert.equal(p.showBudgetToClient, false, `${String(falsy)} should be false`);
  }
});

test('an unparseable Client Portal Enabled closes the gate, never opens it', () => {
  // §9.1 — this field is a clause of the gate. Failing open would expose a
  // project the contractor never enabled.
  const p = mapProject({ properties: { [FIELD_KEYS.clientPortalEnabled]: 'maybe' } });
  assert.equal(p.clientPortalEnabled, false);
  const missing = mapProject({ properties: {} });
  assert.equal(missing.clientPortalEnabled, false);
});

test('an unrecognised stage falls back rather than crashing the screen', () => {
  const p = mapProject({ properties: { [FIELD_KEYS.projectStage]: 'Something Invented' } });
  assert.equal(p.projectStage, 'New Project');
});

test('a missing numeric field is 0, not NaN', () => {
  const p = mapProject({ properties: {} });
  assert.equal(p.contractAmount, 0);
  assert.equal(p.progressPercentage, 0);
  assert.ok(!Number.isNaN(p.margin));
});
