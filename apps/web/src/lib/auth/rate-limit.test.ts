import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clientIpFrom,
  createRateLimiter,
  signInRequestKeys,
  verifyKeys,
  SIGN_IN_REQUEST_LIMIT,
} from './rate-limit.ts';

const NOW = 1_700_000_000;

test('attempts up to the limit are allowed, the next is refused', () => {
  const limiter = createRateLimiter({ limit: 3, windowSeconds: 60 });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(limiter.consume(['k'], { now: NOW }).allowed, true, `attempt ${i + 1}`);
  }
  const refused = limiter.consume(['k'], { now: NOW });
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 60);
});

test('the window resets, and attempts are allowed again after it', () => {
  const limiter = createRateLimiter({ limit: 2, windowSeconds: 60 });
  limiter.consume(['k'], { now: NOW });
  limiter.consume(['k'], { now: NOW });
  assert.equal(limiter.consume(['k'], { now: NOW }).allowed, false);
  assert.equal(limiter.consume(['k'], { now: NOW + 61 }).allowed, true);
});

test('hammering while refused does not let the window drain early', () => {
  const limiter = createRateLimiter({ limit: 1, windowSeconds: 60 });
  limiter.consume(['k'], { now: NOW });
  // Refused attempts still count, so the window keeps its original reset time.
  for (let i = 0; i < 10; i += 1) limiter.consume(['k'], { now: NOW + 30 });
  const refused = limiter.consume(['k'], { now: NOW + 59 });
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 1);
});

test('any one key over its limit refuses the whole request', () => {
  const limiter = createRateLimiter({ limit: 2, windowSeconds: 60 });
  // 'shared' is exhausted by two other callers.
  limiter.consume(['a', 'shared'], { now: NOW });
  limiter.consume(['b', 'shared'], { now: NOW });
  // 'c' is fresh, but 'shared' is not, so the request is refused.
  assert.equal(limiter.consume(['c', 'shared'], { now: NOW }).allowed, false);
});

test('keys are independent, so one caller cannot exhaust another', () => {
  const limiter = createRateLimiter({ limit: 1, windowSeconds: 60 });
  assert.equal(limiter.consume(['a'], { now: NOW }).allowed, true);
  assert.equal(limiter.consume(['b'], { now: NOW }).allowed, true);
  assert.equal(limiter.consume(['a'], { now: NOW }).allowed, false);
});

test('reset clears a key', () => {
  const limiter = createRateLimiter({ limit: 1, windowSeconds: 60 });
  limiter.consume(['k'], { now: NOW });
  assert.equal(limiter.consume(['k'], { now: NOW }).allowed, false);
  limiter.reset('k');
  assert.equal(limiter.consume(['k'], { now: NOW }).allowed, true);
});

test('empty keys are ignored rather than counted as one shared bucket', () => {
  const limiter = createRateLimiter({ limit: 1, windowSeconds: 60 });
  assert.equal(limiter.consume([''], { now: NOW }).allowed, true);
  assert.equal(limiter.consume([''], { now: NOW }).allowed, true);
});

test('the project code is NOT part of the key, so guessing codes cannot reset the counter', () => {
  const limiter = createRateLimiter(SIGN_IN_REQUEST_LIMIT);
  const email = 'dana@example.com';
  // An enumerator varies the code while the email stays constant.
  for (let code = 44; code < 44 + SIGN_IN_REQUEST_LIMIT.limit; code += 1) {
    const keys = signInRequestKeys(email, '203.0.113.9');
    assert.equal(limiter.consume(keys, { now: NOW }).allowed, true, `code BSA-0${code}`);
  }
  // The very next guess is refused, no matter which code it carries.
  const refused = limiter.consume(signInRequestKeys(email, '203.0.113.9'), { now: NOW });
  assert.equal(refused.allowed, false);
});

test('sign-in keys normalize email the way the lookup does', () => {
  assert.deepEqual(signInRequestKeys('  Dana@Example.COM ', '1.2.3.4'), [
    'signin:email:dana@example.com',
    'signin:ip:1.2.3.4',
  ]);
});

test('a missing ip still yields the email key, so the request is never un-limited', () => {
  assert.deepEqual(signInRequestKeys('dana@example.com', ''), ['signin:email:dana@example.com']);
});

test('verify keys are ip-only, and empty without one', () => {
  assert.deepEqual(verifyKeys('1.2.3.4'), ['verify:ip:1.2.3.4']);
  assert.deepEqual(verifyKeys(''), []);
});

test('client ip takes the first entry of the forwarded chain', () => {
  const headers = new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' });
  assert.equal(clientIpFrom(headers), '203.0.113.9');
});

test('client ip falls back to x-real-ip, then to empty', () => {
  assert.equal(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.7' })), '198.51.100.7');
  assert.equal(clientIpFrom(new Headers()), '');
  assert.equal(clientIpFrom(new Headers({ 'x-forwarded-for': '   ' })), '');
});
