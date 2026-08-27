import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERIFICATION_TTL_SECONDS,
  consumeVerificationToken,
  createMemoryConsumedTokens,
  issueVerificationToken,
} from './verification-token.ts';
import { sign } from './session-crypto.ts';

const SECRET = 'test-secret-at-least-32-characters-long';
const OTHER = 'another-secret-at-least-32-characters-x';
const NOW = 1_700_000_000;

test('C-2 a fresh token consumes once and yields the contact', () => {
  const store = createMemoryConsumedTokens();
  const token = issueVerificationToken(
    { contactId: 'contact-johnson', email: 'Dana@Example.com' },
    SECRET,
    { now: NOW, jti: 'j1' },
  );
  const out = consumeVerificationToken(token, SECRET, store, { now: NOW + 60 });
  assert.equal(out.valid, true);
  assert.equal(out.valid && out.contactId, 'contact-johnson');
  // Email is normalized at issue.
  assert.equal(out.valid && out.email, 'dana@example.com');
});

test('C-2 a token cannot be used twice', () => {
  const store = createMemoryConsumedTokens();
  const token = issueVerificationToken({ contactId: 'contact-johnson', email: 'd@e.com' }, SECRET, {
    now: NOW,
    jti: 'j2',
  });
  assert.equal(consumeVerificationToken(token, SECRET, store, { now: NOW + 60 }).valid, true);
  const second = consumeVerificationToken(token, SECRET, store, { now: NOW + 120 });
  assert.equal(second.valid, false);
  assert.equal(second.valid === false && second.reason, 'already_used');
});

test('C-2 an expired token is refused', () => {
  const store = createMemoryConsumedTokens();
  const token = issueVerificationToken({ contactId: 'c', email: 'd@e.com' }, SECRET, {
    now: NOW,
    ttlSeconds: 60,
    jti: 'j3',
  });
  const out = consumeVerificationToken(token, SECRET, store, { now: NOW + 61 });
  assert.equal(out.valid, false);
  assert.equal(out.valid === false && out.reason, 'expired');
});

test('a garbage or tampered token is invalid', () => {
  const store = createMemoryConsumedTokens();
  assert.equal(consumeVerificationToken('not-a-token', SECRET, store).valid, false);

  const token = issueVerificationToken({ contactId: 'c', email: 'd@e.com' }, SECRET, {
    now: NOW,
    jti: 'j4',
  });
  const tampered = `${token.slice(0, -3)}aaa`;
  const out = consumeVerificationToken(tampered, SECRET, store, { now: NOW + 60 });
  assert.equal(out.valid, false);
  assert.equal(out.valid === false && out.reason, 'invalid');
});

test('a token signed with a different secret is invalid', () => {
  const store = createMemoryConsumedTokens();
  const token = issueVerificationToken({ contactId: 'c', email: 'd@e.com' }, SECRET, {
    now: NOW,
    jti: 'j5',
  });
  const out = consumeVerificationToken(token, OTHER, store, { now: NOW + 60 });
  assert.equal(out.valid, false);
  assert.equal(out.valid === false && out.reason, 'invalid');
});

test('a session-shaped cookie cannot authenticate as a magic link (wrong purpose)', () => {
  // Same secret, but no `purpose` claim — a session must not double as a link.
  const store = createMemoryConsumedTokens();
  const sessionish = sign(
    { role: 'client', name: 'Dana', contactId: 'contact-johnson' },
    SECRET,
    { now: NOW },
  );
  const out = consumeVerificationToken(sessionish, SECRET, store, { now: NOW + 60 });
  assert.equal(out.valid, false);
  assert.equal(out.valid === false && out.reason, 'wrong_purpose');
});

test('the default TTL is short-lived', () => {
  assert.ok(VERIFICATION_TTL_SECONDS <= 60 * 60, 'a magic link should not be a standing credential');
});
