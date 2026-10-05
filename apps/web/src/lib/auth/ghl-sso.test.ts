import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { decryptGhlIdentity, readGhlIdentity } from './ghl-sso.ts';

const policy = { secret: 'test-only-shared-secret', companyId: 'company1', requestedLocation: '12345678901234567890' };
const user = { userId: 'user1', companyId: 'company1', activeLocation: policy.requestedLocation, role: 'admin', email: 'staff@example.test' };
const encrypted = (over = {}) => CryptoJS.AES.encrypt(JSON.stringify({ ...user, ...over }), policy.secret).toString();
test('decrypts the actual HighLevel CryptoJS wire format, with tenant and user proof', () => {
  const identity = decryptGhlIdentity(encrypted(), policy);
  assert.equal(identity?.userId, 'user1');
  assert.equal(identity?.locationId, policy.requestedLocation);
  assert.equal(identity?.ghlRole, 'admin');
});
test('refuses wrong secret, agency, location, absent user and malformed context', () => {
  assert.equal(decryptGhlIdentity(encrypted(), { ...policy, secret: 'wrong' }), null);
  assert.equal(decryptGhlIdentity(encrypted(), { ...policy, companyId: 'other' }), null);
  assert.equal(decryptGhlIdentity(encrypted(), { ...policy, requestedLocation: 'other' }), null);
  assert.equal(decryptGhlIdentity(encrypted({ userId: '' }), policy), null);
  assert.equal(decryptGhlIdentity(encrypted({ activeLocation: '' }), policy), null);
  assert.equal(decryptGhlIdentity(encrypted(), { ...policy, secret: undefined }), null);
  assert.equal(decryptGhlIdentity('{}', policy), null);
});

/**
 * The diagnosis half.
 *
 * Added after a live misconfiguration on 5 October 2026: a correct iframe
 * handshake refused, two possible causes, one indistinguishable sentence and no
 * log line. The reasons exist so the operator can tell wrong-secret from
 * wrong-agency without guessing — and must never reach the browser.
 */

const reason = (value: ReturnType<typeof readGhlIdentity>) => (value.ok ? 'ok' : value.reason);

test('§ a wrong shared secret is distinguishable from a wrong agency', () => {
  // The whole point. These two were the live candidates, and telling them
  // apart by configuration alone meant changing one and hoping.
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, secret: 'wrong' })), 'undecryptable');
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, companyId: 'other' })), 'wrong_company');
});

test('§ a wrong agency reports the id the payload actually carried', () => {
  // So the operator reads a diff rather than re-deriving where the real value
  // lives. It is their own agency id, not a secret.
  const refused = readGhlIdentity(encrypted(), { ...policy, companyId: 'other' });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false ? refused.sawCompanyId : null, 'company1');
});

test('§ an agency id is only echoed when the payload carried a string', () => {
  // A payload that decrypted is not automatically one worth echoing whole.
  const odd = readGhlIdentity(encrypted({ companyId: { nested: true } }), policy);
  assert.equal(reason(odd), 'wrong_company');
  assert.equal(odd.ok === false ? odd.sawCompanyId : 'set', undefined);

  const long = readGhlIdentity(encrypted({ companyId: 'c'.repeat(500) }), policy);
  assert.equal(long.ok === false ? (long.sawCompanyId ?? '').length : 0, 64, 'bounded');
});

test('§ missing configuration is never reported as a bad secret', () => {
  // Otherwise the first thing an operator does on a fresh deployment is rotate
  // a secret that was never the problem.
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, secret: undefined })), 'not_configured');
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, secret: '' })), 'not_configured');
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, companyId: undefined })), 'not_configured');
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, companyId: '' })), 'not_configured');
});

test('anything that is not a HighLevel envelope is named as such', () => {
  for (const sent of ['{}', '', 'U2FsdGVkX', 42, null, undefined, { encryptedData: 'x' }]) {
    assert.equal(reason(readGhlIdentity(sent, policy)), 'malformed_envelope');
  }
  assert.equal(reason(readGhlIdentity(`U2FsdGVkX1${'x'.repeat(17_000)}`, policy)), 'malformed_envelope');
});

test('a recognised agency sending an unrecognised user is its own reason', () => {
  assert.equal(reason(readGhlIdentity(encrypted({ userId: '' }), policy)), 'unexpected_shape');
  assert.equal(reason(readGhlIdentity(encrypted({ activeLocation: 'short' }), policy)), 'unexpected_shape');
  assert.equal(reason(readGhlIdentity(encrypted({ role: 'owner' }), policy)), 'unexpected_shape');
});

test('§ a sub-account claimed in the URL is still checked against the payload', () => {
  // The Custom Page sends no sub-account, so this check is often skipped — it
  // must still bite when a claim IS made, or dropping it from one door would
  // have quietly dropped it from both.
  assert.equal(
    reason(readGhlIdentity(encrypted(), { ...policy, requestedLocation: '09876543210987654321' })),
    'location_mismatch',
  );
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, requestedLocation: undefined })), 'ok');
  assert.equal(reason(readGhlIdentity(encrypted(), { ...policy, requestedLocation: '' })), 'ok');
});
