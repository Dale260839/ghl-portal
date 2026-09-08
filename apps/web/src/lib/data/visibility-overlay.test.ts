import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PROJECTS } from './fixtures.ts';
import { applyVisibility, isUuid, overlayFromRow } from './visibility-overlay.ts';

const base = { ...PROJECTS[0]!, buildsuiteProjectId: 'a0000000-0000-4000-8000-000000000001' };
const off = {
  ...base,
  clientPortalEnabled: false,
  showScheduleToClient: false,
  showBudgetToClient: false,
  showDetailedPricing: false,
  showAssignedTeam: false,
};

test('a stored row turns on exactly the switches it stores', () => {
  const overlay = overlayFromRow({
    project_id: off.buildsuiteProjectId,
    client_portal_enabled: true,
    show_schedule: true,
    show_budget: false,
  });
  const [out] = applyVisibility([off], new Map([[off.buildsuiteProjectId, overlay]]));
  assert.equal(out!.clientPortalEnabled, true);
  assert.equal(out!.showScheduleToClient, true);
  assert.equal(out!.showBudgetToClient, false);
  // No column exists for these; the overlay must not touch them.
  assert.equal(out!.showDetailedPricing, false);
  assert.equal(out!.showAssignedTeam, false);
});

test('a project with no row is returned untouched, so nothing turns on by omission', () => {
  const other = { ...off, buildsuiteProjectId: 'b0000000-0000-4000-8000-000000000002' };
  const [a, b] = applyVisibility(
    [off, other],
    new Map([[off.buildsuiteProjectId, overlayFromRow({ project_id: off.buildsuiteProjectId, client_portal_enabled: true, show_schedule: false, show_budget: false })]]),
  );
  assert.equal(a!.clientPortalEnabled, true);
  assert.equal(b, other, 'same object when there is no row');
  assert.equal(b!.clientPortalEnabled, false);
});

test('inputs are never mutated', () => {
  const overlay = overlayFromRow({ project_id: off.buildsuiteProjectId, client_portal_enabled: true, show_schedule: true, show_budget: true });
  applyVisibility([off], new Map([[off.buildsuiteProjectId, overlay]]));
  assert.equal(off.clientPortalEnabled, false);
});

test('an empty overlay map is a plain copy', () => {
  const out = applyVisibility([off], new Map());
  assert.notEqual(out, [off]);
  assert.deepEqual(out, [off]);
});

test('only uuids are eligible for the uuid-keyed table', () => {
  assert.equal(isUuid('ce880b4a-0c2f-4e5b-b564-2f25fb5fbb90'), true);
  assert.equal(isUuid('BSP-2026-000184'), false);
  assert.equal(isUuid(''), false);
});
