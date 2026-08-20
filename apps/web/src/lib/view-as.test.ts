/**
 * "View as" — the demo switcher must not become a tenancy hole.
 *
 * The load-bearing test is `assuming the field view keeps the caller's own
 * tenant keys`. Everything else here is guard-rail; that one is the reason the
 * module is pure rather than inlined into the server action.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isViewingAs, planReturn, planViewAs, realIdentity } from './view-as.ts';
import type { Session } from './demo-accounts.ts';

const ALLIANCE = 'IifYfP2B2NUaoDPdsTTa';
const OWN_PROFILE = '1dca7b15-9904-449b-a702-5725a5d1b069';

const contractor: Session = {
  role: 'contractor',
  name: 'Marcus Reyes',
  email: 'marcus@allianceproservices.com',
  authProfileIds: [OWN_PROFILE],
  ghlLocationId: ALLIANCE,
};

function assumed(target: 'field' | 'client', from: Session = contractor): Session {
  const result = planViewAs(from, target);
  assert.ok(result.ok, 'expected the switch to be allowed');
  return result.session;
}

// ── The tenancy rule ─────────────────────────────────────────────────────────

test('assuming the field view keeps the caller\u2019s own tenant keys', () => {
  const session = assumed('field');

  assert.deepEqual(session.authProfileIds, [OWN_PROFILE]);
  assert.equal(session.ghlLocationId, ALLIANCE);
});

test('assuming the field view never adopts the demo account\u2019s tenant', () => {
  // The `field` demo account is scoped to a different profile than our caller.
  // Inheriting it would show one agency another agency's jobs.
  const other: Session = {
    ...contractor,
    authProfileIds: ['a4502e38-bb67-420b-a7fc-3e1bc3d99c01'],
    ghlLocationId: 'loc_bexar_builders',
  };

  const session = assumed('field', other);

  assert.deepEqual(session.authProfileIds, ['a4502e38-bb67-420b-a7fc-3e1bc3d99c01']);
  assert.equal(session.ghlLocationId, 'loc_bexar_builders');
});

test('a client view carries no tenant key at all', () => {
  const session = assumed('client');

  assert.equal(session.authProfileIds, undefined);
  assert.equal(session.ghlLocationId, undefined);
  // Scoped by contact instead (\u00a79.1).
  assert.equal(typeof session.contactId, 'string');
});

// ── Who may switch ───────────────────────────────────────────────────────────

test('a signed-out visitor cannot switch', () => {
  for (const target of ['field', 'client', 'contractor'] as const) {
    const result = planViewAs(null, target);
    assert.equal(result.ok, false);
  }
});

test('a real field user cannot switch into the client portal', () => {
  const field: Session = { role: 'field', name: 'Tony', email: 't@x.com' };
  const result = planViewAs(field, 'client');

  assert.equal(result.ok, false);
});

test('a real client cannot switch into the dashboard', () => {
  const client: Session = { role: 'client', name: 'Dana', email: 'd@x.com', contactId: 'c-1' };
  const result = planViewAs(client, 'contractor');

  assert.equal(result.ok, false);
});

test('an assumed client view cannot be used to reach further', () => {
  // The session says role: 'client'. Permission is decided on `returnTo`, so
  // the switch is allowed — but only because a contractor is underneath it.
  const viewing = assumed('client');
  assert.ok(planViewAs(viewing, 'field').ok);

  // Strip the real identity and the same session is powerless.
  const orphaned: Session = { ...viewing, returnTo: undefined };
  assert.equal(planViewAs(orphaned, 'field').ok, false);
});

// ── Returning ────────────────────────────────────────────────────────────────

test('returning restores the original contractor exactly', () => {
  const result = planReturn(assumed('client'));

  assert.ok(result.ok);
  assert.deepEqual(result.session, {
    role: 'contractor',
    name: 'Marcus Reyes',
    email: 'marcus@allianceproservices.com',
    authProfileIds: [OWN_PROFILE],
    ghlLocationId: ALLIANCE,
  });
  assert.equal(isViewingAs(result.session), false);
});

test('switching between assumed views does not nest', () => {
  // client -> field -> back should land on the contractor, not on the client.
  const chained = assumed('field', assumed('client'));

  assert.deepEqual(realIdentity(chained), {
    role: 'contractor',
    name: 'Marcus Reyes',
    email: 'marcus@allianceproservices.com',
    authProfileIds: [OWN_PROFILE],
    ghlLocationId: ALLIANCE,
  });

  const back = planReturn(chained);
  assert.ok(back.ok);
  assert.equal(back.session.role, 'contractor');
  assert.equal(back.session.returnTo, undefined);
});

test('selecting contractor from a menu is the same as returning', () => {
  const viewing = assumed('field');
  const viaMenu = planViewAs(viewing, 'contractor');
  const viaReturn = planReturn(viewing);

  assert.ok(viaMenu.ok);
  assert.ok(viaReturn.ok);
  assert.deepEqual(viaMenu.session, viaReturn.session);
});

// ── Where you land ───────────────────────────────────────────────────────────

test('each view redirects to its own home', () => {
  const cases = [
    ['field', '/field'],
    ['client', '/portal'],
    ['contractor', '/dashboard'],
  ] as const;

  for (const [target, expected] of cases) {
    const result = planViewAs(contractor, target);
    assert.ok(result.ok);
    assert.equal(result.redirectTo, expected);
  }
});

test('a plain contractor session is not marked as viewing', () => {
  assert.equal(isViewingAs(contractor), false);
  assert.equal(isViewingAs(null), false);
  assert.equal(isViewingAs(assumed('field')), true);
});
