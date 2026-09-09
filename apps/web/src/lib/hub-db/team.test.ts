/**
 * The team: invitations, passwords, and the permission ticks.
 *
 * The tests that matter here are the ones about what a tick **cannot** do. A
 * contractor handing out access is the moment the privacy model is most likely
 * to be undermined by a well-meaning checkbox.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubClient } from './client.ts';
import {
  HubTeam,
  CLIENT_PROVISIONED_BY,
  INVITABLE_ROLES,
  INVITE_PURPOSE,
  hashPassword,
  hashToken,
  issueInviteToken,
  readInviteToken,
  verifyPassword,
} from './team.ts';
import { GRANTABLE_RESOURCES, effectiveCan, isGrantable } from '../permissions.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';
import { sign } from '../auth/session-crypto.ts';

const SECRET = 'test-secret-at-least-32-characters-long!!';
const scope: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
  contractorId: '5dd312bd-0b95-45af-be7b-c19a14eff103',
};
const actor = { name: 'Marcus Reyes' };

/** A client whose fetch records requests and returns scripted responses. */
function fakeTeam(responses: unknown[] = [[{ id: 'm1', contractor_id: 'c1', email: 'a@b.com', role: 'field', project_ids: [], activated_at: null, password_hash: null, last_seen_at: null, revoked_at: null, created_at: '2026-08-31T00:00:00Z', full_name: null, invited_by: null }]]) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url: String(url),
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
    });
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new HubClient({ url: 'https://hub.example', key: 'k' }, { fetchImpl });
  return { calls, team: new HubTeam(client, SECRET, 'https://hub.example.com') };
}

// ── Passwords ────────────────────────────────────────────────────────────────

test('a password round-trips, and a wrong one is refused', () => {
  const stored = hashPassword('correct horse battery staple');

  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('correct horse battery stapl', stored), false);
  assert.equal(verifyPassword('', stored), false);
});

test('the same password hashes differently every time', () => {
  // A per-password salt. Without it, two people choosing the same password
  // would be visibly identical in the table.
  assert.notEqual(hashPassword('same password'), hashPassword('same password'));
});

test('a malformed stored hash is refused rather than crashing', () => {
  // A corrupt or truncated column must fail closed, not throw and 500.
  for (const bad of ['', 'notahash', 'scrypt$16384$deadbeef', 'bcrypt$1$2$3']) {
    assert.equal(verifyPassword('anything', bad), false);
  }
});

test('the cost is stored with the hash so it can be raised later', () => {
  assert.match(hashPassword('x'), /^scrypt\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
});

// ── Invitation tokens ────────────────────────────────────────────────────────

test('an invite token round-trips and carries its purpose', () => {
  const token = issueInviteToken(
    { email: 'Crew@Example.com ', role: 'field', contractorId: 'c1' },
    SECRET,
  );
  const check = readInviteToken(token, SECRET);

  assert.equal(check.valid, true);
  assert.equal(check.payload.purpose, INVITE_PURPOSE);
  assert.equal(check.payload.email, 'crew@example.com', 'email is normalized');
  assert.equal(check.payload.role, 'field');
});

test('a session cookie is not an invitation', () => {
  // Both are signed with the same secret. Only the purpose keeps them apart,
  // and without this check a session would redeem an invite.
  const session = sign({ role: 'contractor', name: 'Marcus' }, SECRET, { ttlSeconds: 600 });

  const check = readInviteToken(session, SECRET);
  assert.equal(check.valid, false);
  assert.equal(check.reason, 'wrong-purpose');
});

test('a token signed with another secret is refused', () => {
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, 'other-secret-that-is-long-enough!!');

  assert.equal(readInviteToken(token, SECRET).valid, false);
});

test('an expired token is refused and says so', () => {
  const token = issueInviteToken(
    { email: 'a@b.com', role: 'field', contractorId: 'c1' },
    SECRET,
    { ttlSeconds: 60, now: 1_000_000 },
  );

  const check = readInviteToken(token, SECRET, 1_000_000 + 61_000);
  assert.equal(check.valid, false);
  assert.equal(check.reason, 'expired');
});

test('only the hash is ever stored', async () => {
  const { team, calls } = fakeTeam();
  const result = await team.invite(
    scope,
    { email: 'crew@example.com', fullName: 'Crew', role: 'field', projectIds: [] },
    actor,
  );

  const invitationPost = calls.find((c) => c.url.includes('hub_invitations'));
  assert.ok(invitationPost);
  const [row] = invitationPost.body as Record<string, unknown>[];

  assert.equal(row.token_hash, hashToken(result.token));
  assert.equal(
    JSON.stringify(invitationPost.body).includes(result.token),
    false,
    'the raw token must never be written to the database',
  );
});

// ── Who a contractor may invite ──────────────────────────────────────────────

test('a contractor can invite FIELD CREW and nothing else', async () => {
  // Chris, 2026-09-10: homeowners stopped being invited. Their account opens
  // itself when they sign in with the project code from their signed contract,
  // so an invitation is a second door to the same person with different rules —
  // and the invited one goes stale, because it follows whatever a contractor
  // last ticked rather than what the contract says.
  assert.deepEqual([...INVITABLE_ROLES], ['field']);

  const { team } = fakeTeam();

  for (const role of ['contractor', 'client']) {
    await assert.rejects(
      () =>
        team.invite(
          scope,
          { email: 'x@y.com', fullName: '', role: role as 'field', projectIds: [] },
          actor,
        ),
      /not a role a contractor can invite/,
      `${role} must not be invitable`,
    );
  }
});

test('inviting refuses without a scope and reaches no network', async () => {
  const { team, calls } = fakeTeam();

  await assert.rejects(
    () =>
      team.invite(
        null as unknown as TenantScope,
        { email: 'a@b.com', fullName: '', role: 'field', projectIds: [] },
        actor,
      ),
    TenancyError,
  );
  assert.deepEqual(calls, []);
});

test('an obviously invalid email is refused before anything is written', async () => {
  const { team, calls } = fakeTeam();

  await assert.rejects(
    () => team.invite(scope, { email: 'not-an-email', fullName: '', role: 'field', projectIds: [] }, actor),
    /valid email/,
  );
  assert.deepEqual(calls, []);
});

// ── Redeeming ────────────────────────────────────────────────────────────────

function acceptResponses(invitation: Record<string, unknown> | undefined) {
  return [
    invitation === undefined ? [] : [invitation],
    [{ id: 'm1', contractor_id: 'c1', email: 'a@b.com', role: 'field', project_ids: [], activated_at: '2026-08-31T00:00:00Z', password_hash: 'x', last_seen_at: null, revoked_at: null, created_at: '2026-08-31T00:00:00Z', full_name: null, invited_by: null }],
    [],
  ];
}

const validInvitation = {
  id: 'inv-1',
  membership_id: 'm1',
  accepted_at: null,
  revoked_at: null,
  expires_at: '2099-01-01T00:00:00Z',
};

test('a valid invitation activates the membership', async () => {
  const { team } = fakeTeam(acceptResponses(validInvitation));
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, SECRET);

  const result = await team.acceptInvite(token, 'a-long-enough-password');

  assert.equal(result.ok, true);
  assert.equal(result.membership.activated, true);
});

test('an invitation works exactly once', async () => {
  // Single use is enforced by the DATABASE row, not an in-memory set — so it
  // survives a restart and is shared across serverless instances.
  const used = { ...validInvitation, accepted_at: '2026-08-30T00:00:00Z' };
  const { team } = fakeTeam(acceptResponses(used));
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, SECRET);

  const result = await team.acceptInvite(token, 'a-long-enough-password');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'already-used');
});

test('a withdrawn invitation is refused even with a valid signature', async () => {
  const { team } = fakeTeam(acceptResponses({ ...validInvitation, revoked_at: '2026-08-30T00:00:00Z' }));
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, SECRET);

  const result = await team.acceptInvite(token, 'a-long-enough-password');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'revoked');
});

test('a signature with no row behind it is invalid', async () => {
  // The invitation was deleted or never existed. A valid signature alone is
  // not authority.
  const { team } = fakeTeam(acceptResponses(undefined));
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, SECRET);

  const result = await team.acceptInvite(token, 'a-long-enough-password');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid');
});

test('a short password is refused before the token is spent', async () => {
  // Burning the invitation on a rejected password would lock the invitee out
  // with a link that no longer works.
  const { team, calls } = fakeTeam(acceptResponses(validInvitation));
  const token = issueInviteToken({ email: 'a@b.com', role: 'field', contractorId: 'c1' }, SECRET);

  const result = await team.acceptInvite(token, 'short');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'weak-password');
  assert.deepEqual(calls, [], 'nothing may be written on a rejected password');
});

// ── Revoking ─────────────────────────────────────────────────────────────────

test('revoking filters on the contractor as well as the id', async () => {
  const { team, calls } = fakeTeam();

  await team.revoke(scope, 'm1', actor);

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /id=eq\.m1/);
  assert.match(patch.url, /contractor_id=eq\./);
});

test('revoking is a timestamp, not a delete', async () => {
  const { team, calls } = fakeTeam();

  await team.revoke(scope, 'm1', actor);

  assert.equal(calls.some((c) => c.method === 'DELETE'), false);
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(typeof (patch!.body as Record<string, unknown>).revoked_at === 'string');
});

// ── The permission ticks: what they CANNOT do ────────────────────────────────

test('a tick can never grant what the role forbids', () => {
  // THE test. If this ever passes as `true`, a checkbox has become a way to
  // show a homeowner an invoice.
  assert.equal(effectiveCan('client', 'read', 'invoice', { invoice: true }), false);
  assert.equal(effectiveCan('field', 'read', 'invoice', { invoice: true }), false);
  assert.equal(effectiveCan('client', 'delete', 'document', { document: true }), false);
  assert.equal(effectiveCan('field', 'publish', 'dailyUpdate', { dailyUpdate: true }), false);
});

test('a tick can take away what the role allows', () => {
  assert.equal(effectiveCan('client', 'read', 'document'), true);
  assert.equal(effectiveCan('client', 'read', 'document', { document: false }), false);
});

test('no grants at all means exactly the role, not nothing', () => {
  // Absent means "not narrowed". If an absent grant denied, every new person
  // would arrive unable to see anything and every screen would look broken.
  assert.equal(effectiveCan('client', 'read', 'dailyUpdate', {}), true);
  assert.equal(effectiveCan('field', 'read', 'task', {}), true);
});

test('ticks govern reading only, never writing', () => {
  // "May they edit a task" is not a question a visibility checkbox should
  // answer. A tick that silently removed write access would be a support call
  // nobody could diagnose.
  assert.equal(effectiveCan('field', 'update', 'task', { task: false }), true);
  assert.equal(effectiveCan('field', 'read', 'task', { task: false }), false);
});

test('only resources a tick could actually affect are offered', () => {
  // A control that cannot change anything is worse than no control, because
  // someone will believe it worked.
  for (const resource of GRANTABLE_RESOURCES) {
    const reachable =
      effectiveCan('field', 'read', resource) || effectiveCan('client', 'read', resource);
    assert.ok(reachable, `${resource} is tickable but no invitable role can read it`);
  }

  assert.equal(isGrantable('invoice'), false);
  assert.equal(isGrantable('visibilitySettings'), false);
  assert.equal(isGrantable('project'), false);
});

// ── What an invitation grants on the BuildSuite side ────────────────────────

test('a field member inherits the contractor profiles; a client inherits none', async () => {
  // THE distinction. The field interface reads the contractor's projects, so a
  // crew member with no profile is bounced out by assertScope — which is exactly
  // what happened to the first field invitation that went out.
  //
  // A homeowner inheriting them would be handed every project the contractor
  // has. Their access is project_ids plus the §9.1 gate, and an empty profile
  // list is what keeps BuildSuite closed to them.
  const field = fakeTeam();
  await field.team.invite(
    scope,
    { email: 'crew@example.com', fullName: 'Crew', role: 'field', projectIds: [] },
    actor,
  );
  const fieldRow = (field.calls.find((c) => c.url.includes('hub_memberships'))!.body as Record<string, unknown>[])[0]!;
  assert.deepEqual(fieldRow.auth_profile_ids, [...scope.authProfileIds]);

  // The homeowner half of this rule now lives on the provisioning path, since
  // that is the only way a client account is created. The requirement is
  // unchanged: an empty profile list is what keeps BuildSuite closed to them.
  const client = fakeTeam([[], [{ id: 'm-new', contractor_id: 'c1', email: 'owner@example.com', role: 'client', project_ids: ['p1'], activated_at: '2026-09-10T00:00:00Z', password_hash: null, last_seen_at: null, revoked_at: null, created_at: '2026-09-10T00:00:00Z', full_name: 'Owner', invited_by: 'Signed contract' }]]);
  await client.team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p1',
    clientName: 'Owner',
  });
  const clientRow = (client.calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>[])[0]!;
  assert.deepEqual(clientRow.auth_profile_ids, [], 'a homeowner must not inherit BuildSuite access');
  assert.deepEqual(clientRow.project_ids, ['p1'], 'their access is the project they proved');
  assert.equal(clientRow.role, 'client');
});

// ── Homeowners: the account that opens itself from a signed contract ─────────

/** A membership row as PostgREST returns it. */
function clientRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm-client',
    contractor_id: 'c1',
    auth_profile_ids: [],
    email: 'owner@example.com',
    full_name: 'Owner',
    role: 'client',
    project_ids: ['p1'],
    activated_at: '2026-09-01T00:00:00Z',
    password_hash: null,
    last_seen_at: null,
    revoked_at: null,
    created_at: '2026-09-01T00:00:00Z',
    invited_by: CLIENT_PROVISIONED_BY,
    ...over,
  };
}

test('a first sign-in opens the account, activated and with no password', async () => {
  // No hash, ever. The code is checked live against BuildSuite on every visit,
  // so `hub_memberships` holds no client credential to crack — which matters
  // more than usual when the credential is six bits wide.
  const { team, calls } = fakeTeam([[], [clientRow({ id: 'm-new' })]]);
  const result = await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'Owner@Example.com ',
    projectId: 'p1',
    clientName: 'Owner',
  });

  assert.equal(result.ok, true);
  const insert = calls.find((c) => c.method === 'POST')!;
  const row = (insert.body as Record<string, unknown>[])[0]!;

  assert.equal(row.email, 'owner@example.com', 'the address is normalised before it is stored');
  assert.equal(row.role, 'client');
  assert.deepEqual(row.project_ids, ['p1']);
  assert.deepEqual(row.auth_profile_ids, []);
  assert.ok(row.activated_at, 'a homeowner has no set-a-password step to activate them later');
  assert.equal(row.password_hash, undefined, 'the project code must never be stored as a hash');
  assert.equal(row.invited_by, CLIENT_PROVISIONED_BY);
});

test('a second project is ADDED, not swapped in, and no second row is written', async () => {
  // §1.4 — a contact may hold several projects, and eleven client addresses in
  // BuildSuite already do. `hub_memberships_live_email` is unique per
  // (contractor, email), so a row per project is impossible anyway.
  const { team, calls } = fakeTeam([[clientRow({ project_ids: ['p1'] })], [clientRow({ project_ids: ['p1', 'p2'] })]]);

  await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p2',
    clientName: 'Owner',
  });

  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, 'a duplicate row was inserted');
  const patch = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
  assert.deepEqual(patch.project_ids, ['p1', 'p2']);
});

test('signing in again does not re-add a project it already has', async () => {
  const { team, calls } = fakeTeam([[clientRow({ project_ids: ['p1'] })], [clientRow()]]);

  await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p1',
    clientName: 'Owner',
  });

  const patch = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
  assert.deepEqual(patch.project_ids, ['p1']);
});

test('a REVOKED homeowner stays out, and nothing is written', async () => {
  // The one control that overrides the code. The contract still being signed is
  // not an argument against the contractor having withdrawn access — and since
  // a code cannot be un-issued, revoke is the only way to take access back.
  const { team, calls } = fakeTeam([[clientRow({ revoked_at: '2026-09-05T00:00:00Z' })]]);

  const result = await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p1',
    clientName: 'Owner',
  });

  assert.deepEqual(result, { ok: false, reason: 'revoked' });
  assert.deepEqual(
    calls.filter((c) => c.method === 'POST' || c.method === 'PATCH'),
    [],
    'a revoked homeowner must not be silently reinstated by signing in',
  );
});

test('the update is filtered by the contractor as well as the row id', async () => {
  // Same rule as `setProjects`: a membership id is guessable in a way a tenant
  // boundary must not depend on.
  const { team, calls } = fakeTeam([[clientRow()], [clientRow()]]);

  await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p2',
    clientName: 'Owner',
  });

  const url = calls.find((c) => c.method === 'PATCH')!.url;
  assert.match(url, /id=eq\.m-client/);
  assert.match(url, /contractor_id=eq\.c1/);
});

test('signing in never changes a role or a password already set', async () => {
  // Somebody invited as field crew before this flow existed, who then signs a
  // contract, must not be silently demoted to client — or have the password
  // they chose wiped by a code sign-in.
  const { team, calls } = fakeTeam([
    [clientRow({ role: 'field', password_hash: 'scrypt$16384$aa$bb' })],
    [clientRow({ role: 'field' })],
  ]);

  await team.provisionClientFromSignedProject({
    contractorId: 'c1',
    email: 'owner@example.com',
    projectId: 'p2',
    clientName: 'Owner',
  });

  const patch = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
  assert.equal(patch.role, undefined, 'the role must not be rewritten by a sign-in');
  assert.equal(patch.password_hash, undefined, 'an existing password must not be wiped');
  assert.equal(patch.auth_profile_ids, undefined, 'profiles must not be rewritten either');
});

test('the lookup is scoped to the contractor from the signed proposal', async () => {
  // Emails are not unique across contractors — the same homeowner can hold jobs
  // with two of them. Reading by email alone would find the wrong tenant's row.
  const { team, calls } = fakeTeam([[], [clientRow({ id: 'm-new', contractor_id: 'c-other' })]]);
  await team.provisionClientFromSignedProject({
    contractorId: 'c-other',
    email: 'owner@example.com',
    projectId: 'p9',
    clientName: 'Owner',
  });

  const lookup = calls.find((c) => c.method === 'GET')!.url;
  assert.match(lookup, /contractor_id=eq\.c-other/);
  assert.match(lookup, /email=eq\.owner%40example\.com|email=eq\.owner@example\.com/);
});

test('setProjects filters on the contractor, not just the membership id', async () => {
  // A membership id is guessable in a way a tenant boundary must not depend on.
  // The update has to be filtered by the asserted contractor as well, so
  // reassigning somebody else's crew member changes nothing.
  const calls: { filters: Record<string, string> }[] = [];
  const client = {
    async update(args: { filters: Record<string, string> }) {
      calls.push({ filters: args.filters });
      return [];
    },
  };

  const team = new HubTeam(client as never, 'secret', 'http://localhost');
  await team.setProjects(
    { locationId: 'loc', authProfileIds: ['p1'], contractorId: 'contractor-1' },
    'membership-9',
    ['bsp-1'],
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.filters.id, 'eq.membership-9');
  assert.equal(
    calls[0]!.filters.contractor_id,
    'eq.contractor-1',
    'the tenant filter is missing — another contractor could be reassigned',
  );
});

test('setProjects refuses without a resolved contractor', async () => {
  const team = new HubTeam({} as never, 'secret', 'http://localhost');
  await assert.rejects(
    () => team.setProjects({ locationId: 'loc', authProfileIds: ['p1'] }, 'm-1', ['bsp-1']),
    /contractor/i,
  );
});
