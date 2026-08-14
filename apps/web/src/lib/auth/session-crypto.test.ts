/**
 * Signed session tokens.
 *
 * These matter more than they did a day ago: tenancy is now enforced *from the
 * session* (D-012), so a forgeable session means forgeable tenancy. The tests
 * below are mostly about what happens when someone edits the cookie.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateSecret,
  resolveSessionSecret,
  sign,
  verify,
} from './session-crypto.ts';

const SECRET = 'a'.repeat(48);
const OTHER = 'b'.repeat(48);
const NOW = 1_800_000_000;

const claims = { role: 'contractor', authProfileId: '7726102a-8e13-4006-889d-d68bc1cccd40' };

// ── Round trip ───────────────────────────────────────────────────────────────

test('a signed token verifies and returns its claims', () => {
  const token = sign(claims, SECRET, { now: NOW });
  const result = verify<typeof claims>(token, SECRET, { now: NOW + 10 });
  assert.ok(result.valid);
  assert.equal(result.payload.role, 'contractor');
  assert.equal(result.payload.authProfileId, claims.authProfileId);
  assert.equal(result.payload.iat, NOW);
});

test('the token is versioned, so the scheme can change without crashing', () => {
  assert.match(sign(claims, SECRET, { now: NOW }), /^v1\./);
  const result = verify('v2.abc.def', SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.reason : '', 'unsupported_version');
});

// ── Forgery — the point of the exercise ──────────────────────────────────────

test('editing the payload invalidates the token', () => {
  const token = sign(claims, SECRET, { now: NOW });
  const [version, encoded, signature] = token.split('.') as [string, string, string];

  // Exactly what someone would do in devtools: swap the tenant id.
  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  decoded.authProfileId = 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01';
  const tampered = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');

  const result = verify(`${version}.${tampered}.${signature}`, SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.reason : '', 'bad_signature');
});

test('a token signed with another secret is rejected', () => {
  const token = sign(claims, OTHER, { now: NOW });
  const result = verify(token, SECRET, { now: NOW });
  assert.equal(result.valid, false);
  assert.equal(result.valid === false ? result.reason : '', 'bad_signature');
});

test('a token with no signature at all is rejected', () => {
  const [version, encoded] = sign(claims, SECRET, { now: NOW }).split('.');
  for (const forged of [
    `${version}.${encoded}.`,
    `${version}.${encoded}`,
    `${version}.${encoded}.AAAA`,
    'not-a-token',
    '',
  ]) {
    assert.equal(verify(forged, SECRET, { now: NOW }).valid, false, forged.slice(0, 20));
  }
});

test('undefined and null are rejected rather than throwing', () => {
  assert.equal(verify(undefined, SECRET).valid, false);
  assert.equal(verify(null, SECRET).valid, false);
});

test('the signature is checked BEFORE the payload is parsed', () => {
  // Attacker-controlled JSON should never reach JSON.parse on an unverified
  // token — otherwise a session bug becomes a parser bug.
  const [version] = sign(claims, SECRET, { now: NOW }).split('.');
  const garbage = Buffer.from('{not json at all', 'utf8').toString('base64url');
  const result = verify(`${version}.${garbage}.AAAA`, SECRET, { now: NOW });
  assert.equal(result.valid === false ? result.reason : '', 'bad_signature');
});

// ── Expiry ───────────────────────────────────────────────────────────────────

test('an expired token is rejected even though its signature is valid', () => {
  const token = sign(claims, SECRET, { now: NOW, ttlSeconds: 60 });
  assert.ok(verify(token, SECRET, { now: NOW + 59 }).valid);
  const expired = verify(token, SECRET, { now: NOW + 61 });
  assert.equal(expired.valid, false);
  assert.equal(expired.valid === false ? expired.reason : '', 'expired');
});

test('expiry is exclusive at the boundary — no one-second grace', () => {
  const token = sign(claims, SECRET, { now: NOW, ttlSeconds: 60 });
  assert.equal(verify(token, SECRET, { now: NOW + 60 }).valid, false);
});

test('sessions default to an 8-hour working day', () => {
  const token = sign(claims, SECRET, { now: NOW });
  const result = verify(token, SECRET, { now: NOW });
  assert.ok(result.valid);
  assert.equal(result.payload.exp - result.payload.iat, 8 * 60 * 60);
});

// ── Secrets ──────────────────────────────────────────────────────────────────

test('a short secret is refused — it looks configured but is not', () => {
  assert.throws(() => sign(claims, 'too-short'), /at least 32/);
});

test('generated secrets are long and distinct', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

test('production refuses to start without a secret', () => {
  assert.throws(
    () => resolveSessionSecret({ NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    /SESSION_SECRET is missing/,
  );
  // Too short counts as missing — half-configured is not configured.
  assert.throws(
    () =>
      resolveSessionSecret({
        NODE_ENV: 'production',
        SESSION_SECRET: 'short',
      } as unknown as NodeJS.ProcessEnv),
    /SESSION_SECRET is missing/,
  );
});

test('production accepts a proper secret', () => {
  const resolved = resolveSessionSecret({
    NODE_ENV: 'production',
    SESSION_SECRET: SECRET,
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(resolved, SECRET);
});

test('development generates one per process rather than blocking npm run dev', () => {
  const first = resolveSessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
  const second = resolveSessionSecret({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
  assert.equal(first, second, 'stable within a process, so a session survives a reload');
  assert.ok(first.length >= 32);
});
