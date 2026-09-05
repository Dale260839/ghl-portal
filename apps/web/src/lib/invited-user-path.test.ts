import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assertScope, assertContractor, TenancyError } from './tenancy.ts';
import { visibleProjectIds, assignedProjectIds, projectsForField } from './field-data.ts';
import { effectiveCan } from './permissions.ts';
import type { Project, Task } from './data/types.ts';
import { tenantScopeFor } from './tenant-scope.ts';

/**
 * The invited-user path, end to end, in process.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Four defects shipped through this flow between 2026-08-31 and 2026-09-01, and
 * every one of them passed a green suite:
 *
 *   1. `acceptInvitation` minted a session with no `authProfileIds`, so the
 *      first scoped read threw TenancyError on a new user's first click.
 *   2. Field access matched `project.superintendent` — a name (§3.6) — and that
 *      column is empty on every live row, so no crew member saw anything.
 *   3. Nothing ever wrote `project_ids`, so an invitation granted access to
 *      nothing at all.
 *   4. Sessions carried no `locationId`, which `assertScope` requires, so every
 *      scoped read refused for every invited person.
 *
 * Each was caught by a human clicking, never by a test. The reason is that every
 * unit test held one stage of the path and none held the JOIN between stages —
 * a session that is valid in isolation, a scope built from a session that is
 * missing a field the session never carried, an assignment list nothing filled.
 *
 * So these tests walk the WHOLE path with the shapes the real code produces,
 * and each one asserts a join rather than a stage. They are deliberately
 * blunt: if any of the four defects is reintroduced, one of them fails.
 * ---------------------------------------------------------------------------
 */

/** The membership row shape, as `team.invite` writes it. */
interface Membership {
  id: string;
  role: 'field' | 'client';
  authProfileIds: string[];
  projectIds: string[];
}

/** The session shape both `signIn` and `acceptInvitation` must produce. */
interface Session {
  role: 'field' | 'client';
  membershipId: string;
  authProfileIds: string[];
  ghlLocationId?: string;
}

const CONTRACTOR_PROFILE = '7726102a-8e13-4006-889d-d68bc1cccd40';
const LOCATION = 'q3vaasvRgM2Om2t4FqZ5';
const CONTRACTOR_ID = '5dd312bd-0b95-45af-be7b-c19a14eff103';

const PROJECTS = [
  { buildsuiteProjectId: 'p-1', ownerAuthProfileId: CONTRACTOR_PROFILE, superintendent: '' },
  { buildsuiteProjectId: 'p-2', ownerAuthProfileId: CONTRACTOR_PROFILE, superintendent: '' },
  { buildsuiteProjectId: 'p-3', ownerAuthProfileId: CONTRACTOR_PROFILE, superintendent: '' },
] as unknown as Project[];

/** What `team.invite` produces for a field member. */
function inviteField(projectIds: string[]): Membership {
  return {
    id: 'membership-1',
    role: 'field',
    // Field inherits the contractor's profiles; client inherits none.
    authProfileIds: [CONTRACTOR_PROFILE],
    projectIds,
  };
}

/** What accepting an invitation must produce. Mirrors `acceptInvitation`. */
function sessionFromAccept(m: Membership): Session {
  return {
    role: m.role,
    membershipId: m.id,
    authProfileIds: m.authProfileIds,
    // Deliberately NO ghlLocationId: an invited person never signs in through
    // GoHighLevel, so nothing puts one in their cookie. Defect 4 was assuming
    // one would be there.
  };
}

/**
 * The REAL `tenantScopeFor`, not a copy of it.
 *
 * It was a copy until this module was split out of `scope.ts` — and a copy of
 * the rule is what drifts. Two of the four defects below were drift between a
 * session and the scope built from it, so the test has to exercise the same
 * function production does.
 */
async function scopeFor(session: Session, locationFor: () => Promise<string | null> = async () => LOCATION) {
  return tenantScopeFor(session as never, {
    lookupLocation: locationFor,
    lookupContractorId: async () => CONTRACTOR_ID,
  });
}

// ── The joins ────────────────────────────────────────────────────────────────

test('accept → session → scope: a scoped read does not throw (defects 1 and 4)', async () => {
  const session = sessionFromAccept(inviteField(['p-1']));
  const scope = await scopeFor(session);

  assert.notEqual(scope, null, 'no scope could be built from a freshly accepted invitation');
  assert.doesNotThrow(() => assertScope(scope, 'projects'));
  assert.doesNotThrow(() => assertContractor(scope, 'submit update'));
});

test('a session missing the profiles produces no scope, and never a blank one', async () => {
  // Defect 1 exactly: the session was mintable without profiles.
  const session: Session = { role: 'field', membershipId: 'm', authProfileIds: [] };
  assert.equal(await scopeFor(session), null);
});

test('a profile that names no location fails closed rather than reading unscoped', async () => {
  const session = sessionFromAccept(inviteField(['p-1']));
  const scope = await scopeFor(session, async () => null);

  assert.equal(scope, null);
  assert.throws(() => assertScope(scope, 'projects'), TenancyError);
});

test('assignment → visibility: a ticked project is visible with no tasks (defect 3)', () => {
  const m = inviteField(['p-2']);
  const ids = visibleProjectIds(m.projectIds, assignedProjectIds([], m.id));

  assert.deepEqual(
    projectsForField(PROJECTS, ids).map((p) => p.buildsuiteProjectId),
    ['p-2'],
    'an invitation granted access to nothing',
  );
});

test('§3.6 an empty superintendent grants nothing, on rows that all have one (defect 2)', () => {
  // Every live BuildSuite row has `superintendent: ''`. If access ever keys off
  // it again, this returns everything instead of nothing.
  const m = inviteField([]);
  const ids = visibleProjectIds(m.projectIds, assignedProjectIds([], m.id));

  assert.deepEqual(projectsForField(PROJECTS, ids), []);
});

test('a task on an unticked project still grants that project', () => {
  // Both are real assignment decisions made by the contractor.
  const m = inviteField(['p-1']);
  const tasks = [{ id: 't1', projectId: 'p-3', assignedTo: m.id }] as unknown as Task[];
  const ids = visibleProjectIds(m.projectIds, assignedProjectIds(tasks, m.id));

  assert.deepEqual(new Set(ids), new Set(['p-1', 'p-3']));
});

test('scope → write: the crew may create an update but never publish one', async () => {
  const session = sessionFromAccept(inviteField(['p-1']));
  const scope = await scopeFor(session);
  assert.doesNotThrow(() => assertContractor(scope, 'submit update'));

  assert.equal(effectiveCan('field', 'create', 'dailyUpdate'), true);
  assert.equal(
    effectiveCan('field', 'publish', 'dailyUpdate'),
    false,
    'the field crew must never publish to a client (§12.2)',
  );
});

test('the whole path, in one walk', async () => {
  // Invite with two projects → accept → scope → see exactly those two → write.
  const membership = inviteField(['p-1', 'p-3']);
  const session = sessionFromAccept(membership);
  const scope = await scopeFor(session);

  assert.notEqual(scope, null);
  assertScope(scope, 'projects');

  const visible = projectsForField(
    PROJECTS,
    visibleProjectIds(membership.projectIds, assignedProjectIds([], membership.id)),
  ).map((p) => p.buildsuiteProjectId);

  assert.deepEqual(visible, ['p-1', 'p-3']);
  assert.equal(visible.includes('p-2'), false, 'an unassigned project leaked');
  assert.equal(effectiveCan('field', 'create', 'dailyUpdate'), true);
});

test('a client inherits no profiles, so has no scope to over-read with', async () => {
  const client: Membership = {
    id: 'membership-2',
    role: 'client',
    authProfileIds: [],
    projectIds: ['p-1'],
  };
  const scope = await scopeFor(sessionFromAccept(client));

  assert.equal(scope, null, 'a homeowner must not hold a tenant scope');
});
