import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createSharedLoginLimiter } from '../auth/shared-login-limit.ts';

const db = new PGlite();
const sql = readFileSync(new URL('../../../../../supabase/hub/0022_shared_login_limits.sql', import.meta.url), 'utf8');
type Decision = { allowed: boolean; retryAfterSeconds: number };
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(sql);
});
after(async () => { await db.close(); });
const hash = (n: number) => n.toString(16).padStart(64, '0');
const claim = async (kind: string | null, keys: (string | null)[] | null) =>
  (await db.query<{ result: Decision }>('select hub_consume_login_attempt($1,$2) as result', [kind, keys])).rows[0]!.result;

test('code and password budgets are persistent, separate, and fixed by the database', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await claim('code', [hash(1), hash(2)])).allowed, true);
  const refused = await claim('code', [hash(1), hash(2)]);
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterSeconds > 3500 && refused.retryAfterSeconds <= 3600);
  for (let i = 0; i < 10; i++) assert.equal((await claim('password', [hash(1)])).allowed, true);
  const pw = await claim('password', [hash(1)]);
  assert.equal(pw.allowed, false);
  assert.ok(pw.retryAfterSeconds > 800 && pw.retryAfterSeconds <= 900);
});

test('varying email or IP cannot bypass the other exhausted key; duplicate keys count once', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await claim('code', [hash(3), hash(3)])).allowed, true);
  assert.equal((await claim('code', [hash(3), hash(4)])).allowed, false);
  assert.equal((await claim('code', [hash(5), hash(3)])).allowed, false);
});

test('expired windows reset using database time, not caller time', async () => {
  await claim('code', [hash(6)]);
  await db.query("update hub_login_attempts set attempts=6,resets_at=now()-interval '1 second' where key_hash=$1", [hash(6)]);
  assert.equal((await claim('code', [hash(6)])).allowed, true);
  assert.equal((await db.query<{ attempts: number }>('select attempts from hub_login_attempts where key_hash=$1', [hash(6)])).rows[0]!.attempts, 1);
});

test('two independent app instances share the real SQL counter; success does not refund it', async () => {
  const fetchImpl = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    return Response.json(await claim(body.p_kind, body.p_keys));
  }) as typeof fetch;
  const config = () => ({ url: 'https://hub.example.invalid', key: 'fixture' });
  const a = createSharedLoginLimiter('code', config, () => 'fixture-secret', fetchImpl);
  const b = createSharedLoginLimiter('code', config, () => 'fixture-secret', fetchImpl);
  for (let i = 0; i < 5; i++) assert.equal((await a.consume(['code:email:fixture@example.invalid'])).allowed, true);
  await a.reset('code:email:fixture@example.invalid');
  assert.equal((await b.consume(['code:email:fixture@example.invalid'])).allowed, false);
});

test('queued burst stays capped and blocked requests do not grow counters forever', async () => {
  // PGlite queues queries; this is not a multi-connection lock contention test.
  const results = await Promise.all(Array.from({ length: 60 }, () => claim('code', [hash(7), hash(8)])));
  assert.equal(results.filter(r => r.allowed).length, 5);
  const { rows } = await db.query<{ attempts: number }>('select attempts from hub_login_attempts where key_hash in ($1,$2)', [hash(7), hash(8)]);
  assert.deepEqual(rows.map(row => row.attempts), [6, 6]);
});

test('invalid claims are rejected and migration rerun preserves consumed budgets', async () => {
  for (const kind of [null, '', 'unknown']) await assert.rejects(claim(kind, [hash(9)]), /Invalid login limit kind/);
  for (const keys of [null, [], [null], ['raw-email@example.invalid'], [hash(9), hash(10), hash(11)]]) {
    await assert.rejects(claim('code', keys), /Invalid login limit keys/);
  }
  await db.exec(sql);
  assert.equal((await claim('code', [hash(1)])).allowed, false);
});

test('browser roles cannot execute, select or reset counters; service role may claim', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    try {
      await assert.rejects(claim('code', [hash(12)]), /permission denied/);
      await assert.rejects(db.query('select * from hub_login_attempts'), /permission denied/);
      await assert.rejects(db.query('delete from hub_login_attempts'), /permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { assert.equal((await claim('code', [hash(12)])).allowed, true); }
  finally { await db.exec('reset role'); }
});
