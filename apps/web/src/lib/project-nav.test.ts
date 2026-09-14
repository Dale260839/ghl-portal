import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_SECTIONS,
  projectIdFromPath,
  projectSectionBase,
  sectionFromPath,
} from './project-nav.ts';

/**
 * The sidebar's "Projects" parent and its sections (John, 2026-09-15).
 */

const ID = '75233730-d76f-41d7-a495-d40cb7a9c912';

test('the sections are exactly the ones asked for, in that order, plus People', () => {
  assert.deepEqual(
    PROJECT_SECTIONS.map((s) => s.label),
    [
      'Timeline', 'Schedule', 'Daily Updates', 'Designs & Selections', 'Budget',
      'Change Orders', 'Documents', 'Photos & Videos', 'Messages', 'Issues',
      'Payments', 'Completion', 'Visibility', 'People',
    ],
  );
});

test('a project path yields its project; the list and other screens do not', () => {
  assert.equal(projectIdFromPath(`/dashboard/projects/${ID}`), ID);
  assert.equal(projectIdFromPath(`/dashboard/projects/${ID}/schedule`), ID);
  assert.equal(projectIdFromPath('/dashboard/projects'), null);
  assert.equal(projectIdFromPath('/dashboard/projects/'), null);
  assert.equal(projectIdFromPath('/dashboard/team'), null);
  assert.equal(projectIdFromPath('/portal/schedule'), null);
});

test('the section is read from the path, and Overview is the empty one', () => {
  assert.equal(sectionFromPath(`/dashboard/projects/${ID}/change-orders`), 'change-orders');
  assert.equal(sectionFromPath(`/dashboard/projects/${ID}`), '');
  assert.equal(sectionFromPath('/dashboard/invoices'), null);
});

test('section links follow the project you are IN, not the fallback', () => {
  // Otherwise "Schedule" in the sidebar would open some other project's
  // schedule while you are looking at this one.
  assert.equal(
    projectSectionBase(`/dashboard/projects/${ID}/photos`, 'first-active'),
    `/dashboard/projects/${ID}`,
  );
});

test('outside a project, section links use the fallback, or are not shown', () => {
  assert.equal(projectSectionBase('/dashboard', 'first-active'), '/dashboard/projects/first-active');
  assert.equal(projectSectionBase('/dashboard', null), null, 'nowhere honest to point');
  assert.equal(projectSectionBase('/dashboard', '  '), null);
});

test('every section segment is a real route under a project', async () => {
  // A section in the sidebar with no page behind it would be a dead link.
  const { existsSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dashboard', 'projects', '[id]');
  for (const { seg, label } of PROJECT_SECTIONS) {
    assert.ok(existsSync(join(base, seg, 'page.tsx')), `${label} has no page at [id]/${seg}`);
  }
});
