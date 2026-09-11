import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hubScopeOfProject, scopeOfProject, UNKNOWN_LOCATION } from './tenant-scope.ts';
import { PROJECTS } from './data/fixtures.ts';

const project = PROJECTS[0]!;

test('hubScopeOfProject carries the resolved contractor id on top of the project scope', async () => {
  const seen: string[][] = [];
  const scope = await hubScopeOfProject(project, {
    lookupContractorId: async (s) => {
      seen.push([...s.authProfileIds]);
      return 'contractor-1';
    },
  });
  assert.ok(scope !== null);
  assert.equal(scope.contractorId, 'contractor-1');
  assert.deepEqual(scope.authProfileIds, [project.ownerAuthProfileId]);
  assert.deepEqual(seen, [[project.ownerAuthProfileId]]);
});

test('hubScopeOfProject is null, not a throw, when the owner resolves to no contractor', async () => {
  const scope = await hubScopeOfProject(project, { lookupContractorId: async () => null });
  assert.equal(scope, null);
});

test('hubScopeOfProject never asks the resolver about a project with no owner', async () => {
  let asked = 0;
  const scope = await hubScopeOfProject(
    { ...project, ownerAuthProfileId: '' },
    { lookupContractorId: async () => { asked += 1; return 'x'; } },
  );
  assert.equal(scope, null);
  assert.equal(asked, 0);
});

test('a blank location still scopes under the placeholder, with or without a contractor', async () => {
  const blank = { ...project, ghlLocationId: '' };
  assert.equal(scopeOfProject(blank).locationId, UNKNOWN_LOCATION);
  const scope = await hubScopeOfProject(blank, { lookupContractorId: async () => 'c' });
  assert.equal(scope?.locationId, UNKNOWN_LOCATION);
});
