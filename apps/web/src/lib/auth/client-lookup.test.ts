import { test } from 'node:test';
import assert from 'node:assert/strict';

import { beginClientVerification, type ClientLoginReader } from './client-lookup.ts';
import { consumeVerificationToken, createMemoryConsumedTokens } from './verification-token.ts';

const SECRET = 'test-secret-that-is-long-enough-to-sign-with';

/**
 * A reader that records what it was asked, so the tests can assert the gate is
 * delegated rather than reimplemented here. The real matching happens inside
 * the database — see `findProjectForClientLogin`.
 */
function readerOf(
  result: { id: string; ghlContactId: string } | null,
): ClientLoginReader & { calls: { code: string; email: string }[] } {
  const calls: { code: string; email: string }[] = [];
  return {
    calls,
    async findProjectForClientLogin(projectCode: string, clientEmail: string) {
      calls.push({ code: projectCode, email: clientEmail });
      return result;
    },
  };
}

test('C-2 a located client gets a token for the project’s contact', async () => {
  const reader = readerOf({ id: 'proj-1', ghlContactId: 'ghl-abc' });
  const result = await beginClientVerification(
    'Homeowner@Example.com ',
    ' bsa-002 ',
    SECRET,
    reader,
  );

  assert.equal(result.located, true);
  assert.ok(result.token);

  const claims = consumeVerificationToken(result.token, SECRET, createMemoryConsumedTokens());
  assert.equal(claims.valid, true);
  assert.equal(claims.valid && claims.contactId, 'ghl-abc');
  assert.equal(claims.valid && claims.email, 'homeowner@example.com');
});

test('both halves are passed to the single gate, unmodified', async () => {
  // The match must not be reimplemented here. If a second copy of the rule ever
  // appears in this module, it will drift from the one in the reader.
  const reader = readerOf(null);
  await beginClientVerification('a@b.com', 'BSA-007', SECRET, reader);

  assert.deepEqual(reader.calls, [{ code: 'BSA-007', email: 'a@b.com' }]);
});

test('§ no match mints nothing, and says nothing about which half missed', async () => {
  const reader = readerOf(null);
  const result = await beginClientVerification('nobody@example.com', 'BSA-999', SECRET, reader);

  assert.deepEqual(result, { located: false });
  assert.equal(result.token, undefined, 'a token was issued for a record that does not exist');
});

test('a project with no GoHighLevel contact cannot be signed into', async () => {
  // The portal resolves a client BY that id. A token carrying an empty one is a
  // credential identifying nobody, and it would reach a screen that then has to
  // decide what to show — the answer to which must never be "everything".
  const reader = readerOf({ id: 'proj-1', ghlContactId: '   ' });
  const result = await beginClientVerification('a@b.com', 'BSA-002', SECRET, reader);

  assert.deepEqual(result, { located: false });
});

test('the token is the credential, not the code', async () => {
  // Two requests for the same project produce different tokens, so possession
  // of a code is not possession of a credential.
  const reader = readerOf({ id: 'proj-1', ghlContactId: 'ghl-abc' });
  const a = await beginClientVerification('a@b.com', 'BSA-002', SECRET, reader, { jti: 'one' });
  const b = await beginClientVerification('a@b.com', 'BSA-002', SECRET, reader, { jti: 'two' });

  assert.notEqual(a.token, b.token);
});

test('a token signed with another secret is refused', async () => {
  const reader = readerOf({ id: 'proj-1', ghlContactId: 'ghl-abc' });
  const { token } = await beginClientVerification('a@b.com', 'BSA-002', SECRET, reader);

  const claims = consumeVerificationToken(
    token,
    'a-different-secret-entirely-abcdef',
    createMemoryConsumedTokens(),
  );
  assert.equal(claims.valid, false);
});
