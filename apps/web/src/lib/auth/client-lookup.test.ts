import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beginClientVerification, locateClient } from './client-lookup.ts';
import { consumeVerificationToken, createMemoryConsumedTokens } from './verification-token.ts';
import { CONTACTS } from '../data/fixtures.ts';

const SECRET = 'test-secret-at-least-32-characters-long';
const NOW = 1_700_000_000;

const johnson = CONTACTS.find((c) => c.id === 'contact-johnson')!;
const whitfield = CONTACTS.find((c) => c.id === 'contact-whitfield')!;

test('D3 §6 email + an associated project id locates the contact', () => {
  const found = locateClient(johnson.email, johnson.projectIds[0]!, CONTACTS);
  assert.equal(found?.id, 'contact-johnson');
});

test('email is matched case- and whitespace-insensitively', () => {
  const found = locateClient(`  ${johnson.email.toUpperCase()} `, johnson.projectIds[0]!, CONTACTS);
  assert.equal(found?.id, 'contact-johnson');
});

test('a real email with a project that is not theirs locates nothing', () => {
  assert.equal(locateClient(johnson.email, whitfield.projectIds[0]!, CONTACTS), null);
});

test('a real project id with the wrong email locates nothing', () => {
  assert.equal(locateClient('stranger@example.com', johnson.projectIds[0]!, CONTACTS), null);
});

test('empty inputs locate nothing', () => {
  assert.equal(locateClient('', johnson.projectIds[0]!, CONTACTS), null);
  assert.equal(locateClient(johnson.email, '', CONTACTS), null);
});

test('C-2 the lookup MINTS NOTHING — it returns a locator, not a credential', () => {
  const found = locateClient(johnson.email, johnson.projectIds[0]!, CONTACTS);
  assert.ok(found !== null);
  // The returned value is a plain Contact — no token, no session field on it.
  assert.deepEqual(Object.keys(found).sort(), ['email', 'id', 'name', 'projectIds']);
});

test('begin issues a usable token only when located, and nothing otherwise', () => {
  const ok = beginClientVerification(johnson.email, johnson.projectIds[0]!, SECRET, {
    now: NOW,
    jti: 'jb1',
  });
  assert.equal(ok.located, true);
  assert.ok(ok.token);

  // The issued token authenticates the located contact.
  const store = createMemoryConsumedTokens();
  const out = consumeVerificationToken(ok.token, SECRET, store, { now: NOW + 60 });
  assert.equal(out.valid, true);
  assert.equal(out.valid && out.contactId, 'contact-johnson');

  // A miss returns a bare, indistinguishable negative — no token, no detail.
  const miss = beginClientVerification('stranger@example.com', johnson.projectIds[0]!, SECRET, {
    now: NOW,
  });
  assert.equal(miss.located, false);
  assert.equal(miss.token, undefined);
});
