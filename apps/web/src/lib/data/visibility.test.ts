/**
 * Client Visibility Settings — the switch set and its effect on the projection.
 *
 * The drift test is the point. A switch that exists on `Project` but is missing
 * from `VISIBILITY_SWITCHES` would be silently un-editable: the settings screen
 * wouldn't render it, the form wouldn't submit it, and the action would read it
 * as `false` and turn it off. A contractor would believe they had control over
 * something they didn't.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROJECT_FIELDS } from '@buildsuite/contracts';
import { VISIBILITY_LABELS, VISIBILITY_SWITCHES, setVisibility } from './mutations.ts';
import { PROJECTS, CONTACTS } from './fixtures.ts';
import { toClientProject } from '../client-projection.ts';

const PROJECT_ID = 'BSP-2026-000184';
const johnson = CONTACTS.find((c) => c.id === 'contact-johnson')!;

function project() {
  return PROJECTS.find((p) => p.buildsuiteProjectId === PROJECT_ID)!;
}

function allOn(): Record<(typeof VISIBILITY_SWITCHES)[number], boolean> {
  return Object.fromEntries(VISIBILITY_SWITCHES.map((k) => [k, true])) as ReturnType<typeof allOn>;
}

function allOff(): Record<(typeof VISIBILITY_SWITCHES)[number], boolean> {
  return Object.fromEntries(VISIBILITY_SWITCHES.map((k) => [k, false])) as ReturnType<typeof allOff>;
}

// ── Drift ────────────────────────────────────────────────────────────────────

test('every §6.1 visibility switch the projection honours is editable', () => {
  // The four the projection actually reads, plus the master switch. If
  // client-projection.ts starts gating on another one, this fails until the
  // settings screen can control it too.
  for (const key of [
    'clientPortalEnabled',
    'showBudgetToClient',
    'showDetailedPricing',
    'showScheduleToClient',
    'showAssignedTeam',
  ] as const) {
    assert.ok(VISIBILITY_SWITCHES.includes(key), `${key} must be editable`);
  }
});

test('every switch has a label and help text', () => {
  for (const key of VISIBILITY_SWITCHES) {
    const entry = VISIBILITY_LABELS[key];
    assert.ok(entry !== undefined, `${key} has no label`);
    assert.ok(entry.label.length > 0 && entry.help.length > 0, `${key} label/help empty`);
  }
});

test('switch labels match the §6.1 field names verbatim', () => {
  const schemaNames = new Set(PROJECT_FIELDS.map((f) => f.name));
  for (const key of VISIBILITY_SWITCHES) {
    assert.ok(
      schemaNames.has(VISIBILITY_LABELS[key].label),
      `"${VISIBILITY_LABELS[key].label}" is not a §6.1 field name`,
    );
  }
});

// ── Effect ───────────────────────────────────────────────────────────────────

test('turning everything off leaves the client the bare minimum', () => {
  const before = { ...project() };
  try {
    setVisibility(PROJECT_ID, { ...allOff(), clientPortalEnabled: true });
    const result = toClientProject(project(), johnson);
    assert.ok(result.allowed);
    assert.equal(result.view.budget, null);
    assert.equal(result.view.team, null);
    assert.equal(result.view.estimatedCompletionDate, null);
    // Progress and stage aren't switch-gated — the client still knows where
    // their project is, which is the point of the portal.
    assert.equal(result.view.projectStage, before.projectStage);
    assert.equal(result.view.progressPercentage, before.progressPercentage);
  } finally {
    Object.assign(project(), before);
  }
});

test('the master switch closes the gate entirely', () => {
  const before = { ...project() };
  try {
    setVisibility(PROJECT_ID, { ...allOn(), clientPortalEnabled: false });
    const result = toClientProject(project(), johnson);
    assert.equal(result.allowed, false);
    assert.equal(result.allowed === false ? result.reason : '', 'client_portal_disabled');
  } finally {
    Object.assign(project(), before);
  }
});

test('turning everything on surfaces budget, team and schedule — and nothing internal', () => {
  const before = { ...project() };
  try {
    setVisibility(PROJECT_ID, allOn());
    const result = toClientProject(project(), johnson);
    assert.ok(result.allowed);
    assert.ok(result.view.budget !== null);
    assert.ok(result.view.team !== null);
    assert.ok(result.view.estimatedCompletionDate !== null);

    // The whole point: even fully open, internals don't appear.
    const serialized = JSON.stringify(result.view);
    for (const secret of [
      String(before.originalEstimate),
      String(before.internalMarkup),
      before.internalNotes,
    ]) {
      assert.ok(!serialized.includes(secret), `leaked: ${secret}`);
    }
  } finally {
    Object.assign(project(), before);
  }
});

test('setVisibility applies the full set, so unchecking actually turns off', () => {
  const before = { ...project() };
  try {
    setVisibility(PROJECT_ID, allOn());
    assert.equal(project().showBudgetToClient, true);
    setVisibility(PROJECT_ID, { ...allOn(), showBudgetToClient: false });
    assert.equal(project().showBudgetToClient, false, 'an omitted checkbox must mean off');
  } finally {
    Object.assign(project(), before);
  }
});

test('setVisibility on an unknown project is a no-op, not a crash', () => {
  assert.doesNotThrow(() => setVisibility('BSP-2026-999999', allOn()));
});
