import { test } from 'node:test';
import assert from 'node:assert/strict';
import CryptoJS from 'crypto-js';
import { decryptGhlIdentity } from './ghl-sso.ts';

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
