import assert from 'node:assert/strict';
import test from 'node:test';

import { homeFor, type Role } from './demo-accounts.ts';
import { checkSessionForArea, HOME_FOR_ROLE, isRole, ROLE_PHRASE } from './session-mismatch.ts';

/**
 * The error page asks who is signed in before it blames the database.
 *
 * 2026-09-17: "Add to project" on a contractor's People page failed with
 * `only a contractor can manage the team`. The page had been opened as the
 * contractor; by the time of the click the same browser was signed in as field
 * crew. The error page said the Hub database had refused the write.
 */

const ROLES: Role[] = ['contractor', 'field', 'client'];

test('a contractor screen, with the browser now signed in as crew, is named as that', () => {
  assert.deepEqual(checkSessionForArea(['contractor'], 'field'), { kind: 'other-role', role: 'field' });
  assert.deepEqual(checkSessionForArea(['contractor'], 'client'), { kind: 'other-role', role: 'client' });
});

test('a browser with no sign-in at all is told it is signed out', () => {
  for (const allowed of [['contractor'], ['field', 'contractor'], ['client', 'contractor']] as Role[][]) {
    assert.deepEqual(checkSessionForArea(allowed, null), { kind: 'signed-out' });
  }
});

test('the right person gets the ordinary message — a real failure is still reported as one', () => {
  assert.deepEqual(checkSessionForArea(['contractor'], 'contractor'), { kind: 'match' });
  // A contractor previewing the field and portal screens is not a mismatch.
  assert.deepEqual(checkSessionForArea(['field', 'contractor'], 'contractor'), { kind: 'match' });
  assert.deepEqual(checkSessionForArea(['client', 'contractor'], 'contractor'), { kind: 'match' });
  assert.deepEqual(checkSessionForArea(['field', 'contractor'], 'field'), { kind: 'match' });
});

test('"Continue as" goes where signing in would have gone', () => {
  // Repeated rather than imported, so the client bundle never carries the demo
  // identities. Held equal here instead.
  for (const role of ROLES) assert.equal(HOME_FOR_ROLE[role], homeFor(role), role);
});

test('every role has a phrase, and only real roles pass the guard', () => {
  for (const role of ROLES) {
    assert.ok(ROLE_PHRASE[role].length > 0, role);
    assert.equal(isRole(role), true);
  }
  for (const value of [null, undefined, '', 'admin', 'Contractor', 42]) assert.equal(isRole(value), false);
});
