import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSharedLoginLimiter, serverLoginLimiter } from './shared-login-limit.ts';
import { clientCodeKeys } from './rate-limit.ts';
import { signInWithProjectCode } from './client-credentials.ts';
import { unifiedSignIn } from './unified-sign-in.ts';

const config = () => ({ url: 'https://hub.example.test', key: 'test-only-key' });
const salt = () => 'synthetic-limiter-hmac-secret';
const keys = clientCodeKeys(' Owner@Example.Invalid ', '203.0.113.4');

test('RPC sends stable keyed hashes, never raw email, IP or guessed credential', async () => {
  const requests: { url: unknown; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url, init) => {
    requests.push({ url, init });
    return Response.json({ allowed: true, retryAfterSeconds: 0 });
  }) as typeof fetch;
  const a = createSharedLoginLimiter('code', config, salt, fetchImpl);
  const b = createSharedLoginLimiter('code', config, salt, fetchImpl);
  await a.consume(keys);
  await b.consume([...keys].reverse());
  assert.equal(requests[0]!.url, config().url + '/rest/v1/rpc/hub_consume_login_attempt');
  assert.equal(requests[0]!.init!.method, 'POST');
  assert.ok(requests[0]!.init!.signal instanceof AbortSignal);
  assert.equal(requests[0]!.init!.body, requests[1]!.init!.body);
  const body = String(requests[0]!.init!.body);
  assert.ok(!body.includes('owner@') && !body.includes('203.0.113'));
  const parsed = JSON.parse(body);
  assert.deepEqual(Object.keys(parsed), ['p_kind', 'p_keys']);
  assert.equal(parsed.p_kind, 'code');
  assert.equal(parsed.p_keys.length, 2);
  for (const key of parsed.p_keys) assert.match(key, /^[a-f0-9]{64}$/);
  await a.reset(keys[0]!);
  assert.equal(requests.length, 2, 'success does not reset a shared IP/account budget');
});

test('missing migration, outage, malformed reply and timeout never fall back to memory or retry', async () => {
  const responses = [
    () => new Response('{}', { status: 404 }),
    () => new Response('{}', { status: 500 }),
    () => Response.json({}),
    () => Response.json({ allowed: true, retryAfterSeconds: 10 }),
    () => Response.json({ allowed: false, retryAfterSeconds: 0 }),
    () => Response.json({ allowed: false, retryAfterSeconds: -1 }),
    () => Response.json({ allowed: false, retryAfterSeconds: 0.5 }),
    () => { throw new Error('timeout'); },
  ];
  for (const response of responses) {
    let calls = 0;
    const limiter = createSharedLoginLimiter('code', config, salt, (async () => {
      calls++; return response();
    }) as typeof fetch);
    await assert.rejects(async () => limiter.consume(keys));
    assert.equal(calls, 1);
  }
});

test('server refusal preserves retry time and requires at least one key', async () => {
  const limiter = createSharedLoginLimiter('password', config, salt,
    (async () => Response.json({ allowed: false, retryAfterSeconds: 123 })) as typeof fetch);
  assert.deepEqual(await limiter.consume(keys), { allowed: false, retryAfterSeconds: 123 });
  await assert.rejects(async () => limiter.consume([]));
  await assert.rejects(async () => limiter.consume(['a', 'b', 'c']));
});

test('limiter outage blocks homeowner lookup/provisioning and reports unavailable, not bad credentials', async () => {
  const result = await signInWithProjectCode('owner@example.invalid', 'BSA-001', {
    limiter: { async consume() { throw new Error('database offline'); }, reset() {} },
    reader: { async findSignedProjectForClient() { assert.fail('no read without a budget'); } },
    store: { async provisionClientFromSignedProject() { assert.fail('no account without a budget'); } },
  });
  assert.deepEqual(result, { result: 'unavailable' });
});

test('limiter outage blocks password authentication and never reaches development fallback', async () => {
  const result = await unifiedSignIn('crew@example.invalid', 'fixture-password', {
    limiter: { async consume() { throw new Error('database offline'); }, reset() {} },
    member: { async authenticate() { assert.fail('no password check without a budget'); } },
    code: async () => { assert.fail('not a code'); },
    demo: () => { assert.fail('no demo after limiter failure'); },
  });
  assert.equal(result.result, 'refused');
  if (result.result === 'refused') assert.match(result.message, /try again in a moment/i);
});

test('database errors in either password path render a recoverable refusal', async () => {
  for (const credential of ['fixture-password', 'BSA-001']) {
    const result = await unifiedSignIn('crew@example.invalid', credential, {
      limiter: { consume: () => ({ allowed: true, retryAfterSeconds: 0 }), reset() {} },
      member: { async authenticate() { throw new Error('private database detail'); } },
      code: async () => ({ result: 'rejected' }), demo: null,
    });
    assert.equal(result.result, 'refused');
    if (result.result === 'refused') {
      assert.match(result.message, /try again in a moment/i);
      assert.ok(!result.message.includes('private database'));
    }
  }
});

test('live sign-in wires both paths to durable server limiters', () => {
  const source = readFileSync(new URL('../actions.ts', import.meta.url), 'utf8');
  assert.match(source, /passwordSignInLimiter = serverLoginLimiter\('password'\)/);
  assert.match(source, /clientCodeLimiter = serverLoginLimiter\('code'\)/);
  assert.doesNotMatch(source, /createRateLimiter\(/);
});

test('production selector requires shared storage even when configuration is missing', async () => {
  const original = process.env;
  try {
    process.env = { ...original, NODE_ENV: 'production' };
    delete process.env.HUB_SUPABASE_URL;
    delete process.env.HUB_SUPABASE_KEY;
    for (const kind of ['code', 'password'] as const) {
      await assert.rejects(async () => serverLoginLimiter(kind).consume(keys), /unavailable/);
    }
  } finally { process.env = original; }
});
