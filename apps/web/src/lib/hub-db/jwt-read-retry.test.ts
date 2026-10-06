import assert from 'node:assert/strict';
import test from 'node:test';
import { HubClient, HubWriteError } from './client.ts';

const FUTURE = JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future', details: null, hint: null });
const KEY = 'fixture-only-not-a-live-key';
type Reply = { status: number; body: string } | Error;

function fixture(replies: Reply[], timeoutMs = 15_000) {
  const calls: { url: string; init: RequestInit; time: number }[] = [];
  const client = new HubClient({ url: 'https://hub.example.test', key: KEY }, {
    timeoutMs,
    fetchImpl: (async (url, init = {}) => {
      calls.push({ url: String(url), init, time: performance.now() });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return new Response(reply.body, { status: reply.status });
    }) as typeof fetch,
  });
  return { client, calls };
}

test('the exact live JWT timing rejection retries a GET without changing its scope or credentials', async () => {
  const { client, calls } = fixture([
    { status: 401, body: FUTURE },
    { status: 200, body: '[{"id":"update-one"}]' },
  ]);
  const rows = await client.select({ from: 'hub_daily_updates', columns: ['id'],
    filters: { contractor_id: 'eq.tenant-one', project_id: 'eq.project-one' }, order: 'created_at.desc', limit: 5 });
  assert.deepEqual(rows, [{ id: 'update-one' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.url, calls[1]!.url);
  assert.match(calls[0]!.url, /contractor_id=eq.tenant-one/);
  assert.match(calls[0]!.url, /project_id=eq.project-one/);
  assert.deepEqual(calls[0]!.init, calls[1]!.init);
  assert.equal(new Headers(calls[1]!.init.headers).get('Authorization'), `Bearer ${KEY}`);
  assert.ok(calls[1]!.time - calls[0]!.time >= 450, 'backoff must not become a busy loop');
});

test('two timing rejections can recover on the third and final GET attempt', async () => {
  const { client, calls } = fixture([
    { status: 401, body: FUTURE }, { status: 401, body: FUTURE }, { status: 200, body: '[]' },
  ]);
  assert.deepEqual(await client.select({ from: 'hub_daily_updates' }), []);
  assert.equal(calls.length, 3);
  assert.ok(calls[2]!.time - calls[1]!.time >= 950);
  assert.equal(calls[0]!.init.signal, calls[2]!.init.signal, 'attempts share one total deadline');
});

test('persistent timing rejection stops after three requests and still reports the original failure', async () => {
  const { client, calls } = fixture([{ status: 401, body: FUTURE }]);
  await assert.rejects(client.select({ from: 'hub_daily_updates' }), (error: unknown) => {
    assert.ok(error instanceof HubWriteError);
    assert.equal(error.status, 401);
    assert.equal(error.table, 'hub_daily_updates');
    assert.match(error.message, /PGRST303/);
    assert.match(error.message, /JWT issued at future/);
    assert.doesNotMatch(error.message, /fixture-only/);
    return true;
  });
  assert.equal(calls.length, 3);
});

test('other auth errors, status codes and malformed bodies are never retried', async () => {
  const replies: Reply[] = [
    { status: 403, body: FUTURE }, { status: 500, body: FUTURE }, { status: 429, body: FUTURE },
    { status: 401, body: '{"code":"PGRST303","message":"JWT expired"}' },
    { status: 401, body: '{"code":"OTHER","message":"JWT issued at future"}' },
    ...['null', '[]', '{}', 'not-json', 'JWT issued at future', '{"code":"PGRST303"}']
      .map(body => ({ status: 401, body })),
  ];
  for (const reply of replies) {
    const { client, calls } = fixture([reply]);
    await assert.rejects(client.select({ from: 'hub_daily_updates' }), HubWriteError);
    assert.equal(calls.length, 1);
  }
});

test('POST, PATCH and upsert never retry even this exact JWT rejection', async () => {
  for (const kind of ['insert', 'update', 'upsert'] as const) {
    const { client, calls } = fixture([{ status: 401, body: FUTURE }]);
    const write = kind === 'update'
      ? client.update({ from: 'hub_tasks', filters: { id: 'eq.task-one' }, patch: { status: 'In Progress' } })
      : kind === 'insert'
        ? client.insert({ from: 'hub_daily_updates', rows: [{ project_id: 'project-one' }] })
        : client.upsert({ from: 'hub_project_state', rows: [{ project_id: 'project-one' }] }, 'project_id');
    await assert.rejects(write, HubWriteError);
    assert.equal(calls.length, 1, kind);
  }
});

test('network failures are not retried, including after an initial timing rejection', async () => {
  for (const replies of [
    [new TypeError('Network disconnected')],
    [{ status: 401, body: FUTURE }, new TypeError('Network disconnected')],
  ]) {
    const { client, calls } = fixture(replies);
    await assert.rejects(client.select({ from: 'hub_daily_updates' }), (error: unknown) => {
      assert.ok(error instanceof HubWriteError);
      assert.equal(error.status, null);
      return true;
    });
    assert.equal(calls.length, replies.length);
  }
});

test('the total timeout interrupts backoff without issuing another request', async () => {
  const { client, calls } = fixture([{ status: 401, body: FUTURE }], 50);
  await assert.rejects(client.select({ from: 'hub_daily_updates' }), (error: unknown) => {
    assert.ok(error instanceof HubWriteError);
    assert.equal(error.status, null);
    assert.match(error.message, /could not be confirmed/);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init.signal?.aborted, true);
});

test('a different error on the retry stops immediately rather than consuming all attempts', async () => {
  const { client, calls } = fixture([
    { status: 401, body: FUTURE }, { status: 403, body: '{"message":"permission denied"}' },
  ]);
  await assert.rejects(client.select({ from: 'hub_daily_updates' }), (error: unknown) => {
    assert.ok(error instanceof HubWriteError);
    assert.equal(error.status, 403);
    assert.match(error.message, /permission denied/);
    return true;
  });
  assert.equal(calls.length, 2);
});
