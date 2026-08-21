/**
 * Demo mode's fictional tenant must cover every fixture.
 *
 * Demo mode does not bypass tenancy — it supplies a scope like any other
 * request, and the fixtures are filtered by it. So if someone adds a fixture
 * owned by a profile `DEMO_SCOPE` does not list, that project silently
 * disappears from the demo with no error anywhere. This test is the error.
 *
 * `demo-mode.ts` carries `server-only`, so the constant is duplicated here
 * rather than imported. That duplication is the thing being checked.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROJECTS } from './fixtures.ts';

/** Must stay identical to DEMO_SCOPE.authProfileIds in `lib/demo-mode.ts`. */
const DEMO_PROFILE_IDS = [
  '7726102a-8e13-4006-889d-d68bc1cccd40',
  'a4502e38-bb67-420b-a7fc-3e1bc3d99c01',
];

test('the demo scope owns every fixture project', () => {
  const uncovered = PROJECTS.filter((p) => !DEMO_PROFILE_IDS.includes(p.ownerAuthProfileId));

  assert.deepEqual(
    uncovered.map((p) => `${p.projectName} (${p.ownerAuthProfileId})`),
    [],
    'add the owner to DEMO_SCOPE in lib/demo-mode.ts, or the project vanishes in demo mode',
  );
});

test('the demo scope lists no profile that owns nothing', () => {
  // A stale id here is harmless but misleading — it implies fixtures exist for
  // a tenant that has none.
  const owners = new Set(PROJECTS.map((p) => p.ownerAuthProfileId));
  const unused = DEMO_PROFILE_IDS.filter((id) => !owners.has(id));

  assert.deepEqual(unused, []);
});

test('fixtures span more than one tenant, so the scoping is actually exercised', () => {
  const owners = new Set(PROJECTS.map((p) => p.ownerAuthProfileId));

  assert.ok(owners.size > 1, 'single-tenant fixtures would not prove the filter runs');
});
