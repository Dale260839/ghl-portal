import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTtlCache } from './ttl-cache.ts';

test('returns the cached value within the ttl and recomputes after it', async () => {
  let clock = 1_000;
  let computes = 0;
  const cache = createTtlCache<number>(500, () => clock);

  assert.equal(await cache.get('t', async () => ++computes), 1);
  clock += 400;
  assert.equal(await cache.get('t', async () => ++computes), 1, 'still fresh');
  clock += 200;
  assert.equal(await cache.get('t', async () => ++computes), 2, 'expired, recomputed');
  assert.equal(computes, 2);
});

test('keys are independent — one tenant never sees another', async () => {
  const cache = createTtlCache<string>(10_000, () => 0);
  assert.equal(await cache.get('a,b', async () => 'tenant-1'), 'tenant-1');
  assert.equal(await cache.get('c', async () => 'tenant-2'), 'tenant-2');
  assert.equal(await cache.get('a,b', async () => 'wrong'), 'tenant-1');
});

test('concurrent callers for one key share a single compute', async () => {
  let computes = 0;
  const cache = createTtlCache<number>(10_000, () => 0);
  const slow = () =>
    new Promise<number>((resolve) => setTimeout(() => resolve(++computes), 10));

  const results = await Promise.all([cache.get('k', slow), cache.get('k', slow), cache.get('k', slow)]);
  assert.deepEqual(results, [1, 1, 1]);
  assert.equal(computes, 1);
});

test('a failed compute is not cached, so the next call retries', async () => {
  let attempts = 0;
  const cache = createTtlCache<string>(10_000, () => 0);

  await assert.rejects(
    cache.get('k', async () => {
      attempts++;
      throw new Error('db down');
    }),
  );
  assert.equal(await cache.get('k', async () => {
    attempts++;
    return 'ok';
  }), 'ok');
  assert.equal(attempts, 2);
});

test('clear drops entries', async () => {
  const cache = createTtlCache<number>(10_000, () => 0);
  await cache.get('k', async () => 1);
  cache.clear();
  assert.equal(await cache.get('k', async () => 2), 2);
});
