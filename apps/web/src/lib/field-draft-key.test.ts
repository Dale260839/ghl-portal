import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldDraftKey } from './field-draft-key.ts';

const session = { role: 'field' as const, name: 'Same Name', email: '', membershipId: 'member1' };
const scope = { contractorId: 'c1', authProfileIds: ['a1'], locationId: 'location' };
test('draft keys isolate users and contractors rather than names', () => {
  const key = fieldDraftKey(session, scope);
  assert.ok(key);
  assert.notEqual(key, fieldDraftKey({ ...session, membershipId: 'member2' }, scope));
  assert.notEqual(key, fieldDraftKey(session, { ...scope, contractorId: 'c2' }));
  assert.equal(fieldDraftKey({ ...session, membershipId: undefined }, scope), null);
  assert.equal(key.includes(session.membershipId), false);
});
