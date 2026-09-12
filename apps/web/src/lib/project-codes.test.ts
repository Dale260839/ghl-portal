import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clientCode,
  clientReference,
  contractorCode,
  projectById,
  projectNameById,
  UNLISTED_PROJECT,
} from './project-codes.ts';

/**
 * The display rule (Sing, 2026-09-12). Contractor: COALESCE(award_code,
 * project_code), with project_code as the client reference when they differ.
 * Client: project_code, always.
 */

const BSA_053 = { projectCode: 'BSA-053', awardCode: 'BSA-APS-003' };
const SELF_CREATED = { projectCode: 'BSA-APS-001', awardCode: null };

test('BSA-053 reads BSA-APS-003 for the contractor, client ref BSA-053', () => {
  assert.equal(contractorCode(BSA_053), 'BSA-APS-003');
  assert.equal(clientReference(BSA_053), 'BSA-053');
});

test('a self-created project shows its own code and no client ref', () => {
  // "The two self-created rows stay as they are because they have no award_code."
  for (const p of [SELF_CREATED, { projectCode: 'BSA-APS-002', awardCode: null }]) {
    assert.equal(contractorCode(p), p.projectCode);
    assert.equal(clientReference(p), null, 'no "client ref" repeating the same code');
  }
});

test('the client ALWAYS sees project_code, never the award code', () => {
  // It is what the signature automation emails them and what they sign in with.
  assert.equal(clientCode(BSA_053), 'BSA-053');
  assert.equal(clientCode(SELF_CREATED), 'BSA-APS-001');
});

test('an award code equal to the project code is not shown twice', () => {
  const p = { projectCode: 'BSA-APS-004', awardCode: 'BSA-APS-004' };
  assert.equal(contractorCode(p), 'BSA-APS-004');
  assert.equal(clientReference(p), null);
});

test('blank values are treated as absent, not as codes', () => {
  // A free-text column on somebody else's database: '' and '  ' are not codes,
  // and COALESCE must fall through them rather than print an empty string.
  assert.equal(contractorCode({ projectCode: 'BSA-053', awardCode: '  ' }), 'BSA-053');
  assert.equal(contractorCode({ projectCode: '', awardCode: null }), null);
  assert.equal(clientReference({ projectCode: '', awardCode: 'BSA-APS-003' }), null);
});

test('a source that knows nothing about awards still works', () => {
  // `awardCode` is optional: fixtures and the GHL source never set it.
  assert.equal(contractorCode({ projectCode: 'BSA-044' }), 'BSA-044');
  assert.equal(clientReference({ projectCode: 'BSA-044' }), null);
});

// ── Naming a project by id never prints the id ───────────────────────────────

const LIST = [
  { buildsuiteProjectId: '75233730-d76f-41d7-a495-d40cb7a9c912', projectName: 'Handyman / Small Repairs' },
];

test('a listed project is named by its name', () => {
  assert.equal(projectNameById(LIST, '75233730-d76f-41d7-a495-d40cb7a9c912'), 'Handyman / Small Repairs');
});

test('an unlisted project is named in words, never by its id', () => {
  // Six screens each fell back to the raw UUID here (John, 2026-09-12: "make
  // sure not display any project id that is random strings").
  const id = 'bbd77380-ebc6-417f-8aaf-0f03150198dc';
  const name = projectNameById(LIST, id);
  assert.equal(name, UNLISTED_PROJECT);
  assert.equal(name.includes(id.slice(0, 8)), false);
  assert.equal(projectById(LIST, id), undefined);
});

test('a listed project with a blank name is still never named by its id', () => {
  const id = 'p-blank';
  assert.equal(projectNameById([{ buildsuiteProjectId: id, projectName: '  ' }], id), UNLISTED_PROJECT);
});
