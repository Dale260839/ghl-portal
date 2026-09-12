import assert from 'node:assert/strict';
import test from 'node:test';

import { hubScopeOfProject } from './tenant-scope.ts';
import { awardAllows } from './data/buildsuite-source.ts';
import type { Project } from './data/types.ts';

/**
 * `awarded_contractor_id` across the modules (John, 2026-09-12).
 *
 * Every client-side Hub read goes through `hubScopeOfProject`; every contractor
 * project read goes through `listProjects`. Both must follow the award, so the
 * contractor who writes a project's Hub rows and the homeowner who reads them
 * land on the same partition.
 */

function project(over: Partial<Project>): Project {
  return {
    buildsuiteProjectId: 'p-053',
    ownerAuthProfileId: 'aps-profile',
    ghlLocationId: 'loc-1',
    projectCode: 'BSA-053',
    ...over,
  } as Project;
}

test('an awarded project is filed under the contractor the award names', async () => {
  let inferred = false;
  const scope = await hubScopeOfProject(project({ awardedContractorId: 'aps-contractor' }), {
    lookupContractorId: async () => {
      inferred = true;
      return 'something-inferred';
    },
  });
  assert.equal(scope?.contractorId, 'aps-contractor');
  assert.equal(inferred, false, 'nothing to infer when BuildSuite recorded the award');
});

test('the award wins even when inference would say someone else', async () => {
  // If the two ever disagree, the award is BuildSuite's own record of who won.
  const scope = await hubScopeOfProject(project({ awardedContractorId: 'aps-contractor' }), {
    lookupContractorId: async () => 'a-different-contractor',
  });
  assert.equal(scope?.contractorId, 'aps-contractor');
});

test('an unawarded project still infers its contractor, exactly as before', async () => {
  const scope = await hubScopeOfProject(project({ awardedContractorId: null }), {
    lookupContractorId: async () => 'owner-contractor',
  });
  assert.equal(scope?.contractorId, 'owner-contractor');
});

test('a contractor may only operate an awarded project the award names', () => {
  const awarded = project({ awardedContractorId: 'aps-contractor' });
  const base = { locationId: 'loc-1', authProfileIds: ['aps-profile'] };
  assert.equal(awardAllows(awarded, { ...base, contractorId: 'aps-contractor' }), true);
  // Otherwise the contractor writes one partition and the homeowner reads another.
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(awardAllows(awarded, { ...base, contractorId: 'someone-else' }), false);
  } finally {
    console.warn = warn;
  }
});

test('unawarded projects and unlinked sessions are left to the tenant filter', () => {
  const base = { locationId: 'loc-1', authProfileIds: ['aps-profile'] };
  assert.equal(awardAllows(project({ awardedContractorId: null }), { ...base, contractorId: 'x' }), true);
  assert.equal(awardAllows(project({ awardedContractorId: 'aps-contractor' }), base), true);
});
