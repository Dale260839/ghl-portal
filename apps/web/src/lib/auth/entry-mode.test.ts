import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readEntry } from './entry-mode.ts';

/**
 * Which door the sign-in page takes.
 *
 * The rule these hold: **the frame supplies the sub-account, the URL supplies it
 * only when there is no frame.** Getting that backwards refuses every
 * Marketplace Custom Page sign-in — which is precisely what happened on
 * 5 October 2026, with "This link is missing its sub-account" shown to a
 * contractor whose sub-account was sitting in the encrypted payload all along.
 */

const embedded = { hasSignature: false, insideFrame: true };
const topLevel = { hasSignature: false, insideFrame: false };

test('§ a Custom Page with no sub-account in the URL still signs in', () => {
  // GoHighLevel does not substitute merge fields into a Custom Page URL. There
  // is no locationId to require, so requiring one is a closed door.
  assert.deepEqual(readEntry({ ...embedded, locationId: '' }), {
    kind: 'embedded',
    locationId: null,
  });
});

test('§ a sub-account in the URL is kept, so the server can still cross-check it', () => {
  // The decrypted payload decides. This is the second opinion the server
  // compares it against, and dropping it would retire that check silently.
  assert.deepEqual(readEntry({ ...embedded, locationId: 'IifYfP2B2NUaoDPdsTTa' }), {
    kind: 'embedded',
    locationId: 'IifYfP2B2NUaoDPdsTTa',
  });
});

test('§ outside a frame the URL is the only source, so an absent one is refused', () => {
  // Nothing to ask, nothing to decrypt. Proceeding would mean guessing whose
  // data to load, and the guess would eventually be somebody else's.
  const blocked = readEntry({ ...topLevel, locationId: '' });
  assert.equal(blocked.kind, 'blocked');
  assert.match(blocked.kind === 'blocked' ? blocked.message : '', /missing its sub-account/);

  assert.deepEqual(readEntry({ ...topLevel, locationId: 'IifYfP2B2NUaoDPdsTTa' }), {
    kind: 'direct',
    locationId: 'IifYfP2B2NUaoDPdsTTa',
  });
});

test('a blank sub-account is an absent one, not a sub-account named " "', () => {
  assert.equal(readEntry({ ...topLevel, locationId: '   ' }).kind, 'blocked');
  assert.deepEqual(readEntry({ ...embedded, locationId: '   ' }), {
    kind: 'embedded',
    locationId: null,
  });
  // And a real one is not left with the whitespace it arrived with.
  assert.deepEqual(readEntry({ ...topLevel, locationId: ' IifYfP2B2NUaoDPdsTTa ' }), {
    kind: 'direct',
    locationId: 'IifYfP2B2NUaoDPdsTTa',
  });
});

test('§ an uninterpolated merge field is refused in BOTH doors', () => {
  // The embedded door could ignore it and sign the person in from the payload.
  // That is the reason to refuse: a link that works despite being wrong stays
  // wrong, and the next person to read it believes it.
  for (const where of [embedded, topLevel]) {
    const blocked = readEntry({ ...where, locationId: '{{location.id}}' });
    assert.equal(blocked.kind, 'blocked');
    assert.match(blocked.kind === 'blocked' ? blocked.message : '', /did not fill in/);
    assert.match(blocked.kind === 'blocked' ? (blocked.hint ?? '') : '', /\{\{location\.id\}\}/);
  }
});

test('§ a signed link proves itself, frame or no frame', () => {
  // The signature is already proof. Asking a parent frame for context we hold
  // would add a handshake that can only fail.
  assert.deepEqual(
    readEntry({ locationId: 'IifYfP2B2NUaoDPdsTTa', hasSignature: true, insideFrame: true }),
    { kind: 'direct', locationId: 'IifYfP2B2NUaoDPdsTTa' },
  );
});
