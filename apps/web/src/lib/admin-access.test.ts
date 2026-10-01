import { test } from 'node:test';
import assert from 'node:assert/strict';

import { adminLocationIds, isAdminSession } from './admin-access.ts';
import type { Session } from './session.ts';

/**
 * Who gets the operator controls.
 *
 * These were gated on environment flags, which could not tell one contractor
 * from another — so with 149 sub-accounts live, every one of them saw "Switch
 * account" and "Viewing as". The gate is an identity now, and these tests hold
 * the two ends of it: the agency's own sub-account gets them, and an absent
 * configuration gives them to nobody rather than guessing.
 */

const AFC = 'IifYfP2B2NUaoDPdsTTa';
const APS = 'IyKL37e3QdiFBx5ESI2d';

const session = (over: Partial<Session> = {}): Session =>
  ({
    role: 'contractor',
    name: 'Someone',
    email: 'someone@example.com',
    authProfileIds: ['profile-1'],
    ghlLocationId: AFC,
    ghlUserId: 'operator-1',
    ghlIdentityVerified: true,
    ghlRole: 'admin',
    ...over,
  }) as Session;

const env = (value?: string) =>
  ({ ...(value === undefined ? {} : { ADMIN_LOCATION_IDS: value }) }) as unknown as NodeJS.ProcessEnv;

test('§ the agency’s own sub-account gets the operator controls', () => {
  assert.equal(isAdminSession(session(), env(AFC)), true);
});

test('§ another contractor does not, however the flags are set', () => {
  // The failure this closes: 149 sub-accounts, one flag, everybody in.
  assert.equal(isAdminSession(session({ ghlLocationId: APS }), env(AFC)), false);
});

test('§ an unset variable gives the controls to NOBODY', () => {
  // Not "the first location", not "the deployment's own". A default that
  // guesses who the administrator is will eventually guess in somebody's
  // favour, and the cost of guessing wrong here is one contractor reaching
  // another's records.
  assert.equal(isAdminSession(session(), env()), false);
  assert.equal(isAdminSession(session(), env('')), false);
  assert.equal(isAdminSession(session(), env('   ')), false);
  assert.deepEqual(adminLocationIds(env()), []);
});

test('several sub-accounts can be named, separated by commas or spaces', () => {
  assert.deepEqual(adminLocationIds(env(`${AFC}, ${APS}`)), [AFC, APS]);
  assert.deepEqual(adminLocationIds(env(`${AFC}\n${APS}`)), [AFC, APS]);
  assert.equal(isAdminSession(session({ ghlLocationId: APS }), env(`${AFC},${APS}`)), true);
});

test('§ viewing as somebody else does not revoke it', () => {
  // Mid-view the session says role 'field' and carries the crew member's
  // details. Reading the surface session would strand an admin in the assumed
  // view with no way back — the identity that counts is the one they came from.
  const viewing = session({
    role: 'field',
    name: 'A crew member',
    ghlLocationId: undefined,
    returnTo: {
      role: 'contractor',
      name: 'Admin',
      email: 'admin@alliance4contractors.com',
      authProfileIds: ['profile-1'],
      ghlLocationId: AFC,
      ghlUserId: 'operator-1',
      ghlIdentityVerified: true,
      ghlRole: 'admin',
    },
  } as Partial<Session>);

  assert.equal(isAdminSession(viewing, env(AFC)), true);
});

test('§ a homeowner or a crew member is never an operator', () => {
  // A homeowner's session carries no sub-account at all; a crew member's
  // belongs to their contractor rather than to them.
  assert.equal(isAdminSession(session({ role: 'client', ghlLocationId: AFC }), env(AFC)), false);
  assert.equal(isAdminSession(session({ role: 'field', ghlLocationId: AFC }), env(AFC)), false);
  assert.equal(isAdminSession(null, env(AFC)), false);
});

test('a session with no sub-account is not an operator, whatever is configured', () => {
  assert.equal(isAdminSession(session({ ghlLocationId: '' }), env(AFC)), false);
  assert.equal(isAdminSession(session({ ghlLocationId: undefined }), env(AFC)), false);
});

test('a location alone never grants operator access', () => {
  assert.equal(isAdminSession(session({ ghlIdentityVerified: false }), env(AFC)), false);
  assert.equal(isAdminSession(session({ ghlUserId: undefined }), env(AFC)), false);
  assert.equal(isAdminSession(session({ ghlRole: 'user' }), env(AFC)), false);
  assert.equal(isAdminSession(session(), { ...env(AFC), ADMIN_GHL_USER_IDS: 'different-user' }), false);
  assert.equal(isAdminSession(session({ ghlRole: 'user' }), { ...env(AFC), ADMIN_GHL_USER_IDS: 'operator-1' }), true);
});
