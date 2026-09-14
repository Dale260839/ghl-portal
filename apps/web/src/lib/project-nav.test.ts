import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_SECTIONS,
  activeSection,
  chooserPath,
  parseOpenSection,
  projectIdFromPath,
  projectSectionPath,
  sectionFromPath,
  sectionHref,
} from './project-nav.ts';

/**
 * The sidebar's "Projects" parent, its sections, and the project chooser
 * (John, 2026-09-15).
 */

const ID = '75233730-d76f-41d7-a495-d40cb7a9c912';

test('the sections are the ones asked for, Overview first and People last', () => {
  // Overview was a tab; with the tabs gone it has to live in the sidebar, or a
  // contractor inside a project has no way back to its summary.
  assert.deepEqual(
    PROJECT_SECTIONS.map((s) => s.label),
    [
      'Overview', 'Timeline', 'Schedule', 'Daily Updates', 'Designs & Selections', 'Budget',
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
});

test('inside a project, a section opens THAT project', () => {
  assert.equal(sectionHref(`/dashboard/projects/${ID}/photos`, 'timeline'), `/dashboard/projects/${ID}/timeline`);
  assert.equal(sectionHref(`/dashboard/projects/${ID}`, ''), `/dashboard/projects/${ID}`);
});

test('outside a project, a section asks which project — it never picks one', () => {
  // It used to open the first active project, for a project nobody chose.
  for (const where of ['/dashboard', '/dashboard/team', '/dashboard/projects', '/dashboard/invoices']) {
    assert.equal(sectionHref(where, 'timeline'), '/dashboard/projects?open=timeline', where);
  }
  assert.equal(sectionHref('/dashboard', ''), '/dashboard/projects', 'Overview is just the list');
});

test('the chooser only accepts sections that exist', () => {
  assert.equal(parseOpenSection('timeline')?.label, 'Timeline');
  assert.equal(parseOpenSection('CHANGE-ORDERS')?.seg, 'change-orders');
  assert.equal(parseOpenSection(['people', 'budget'])?.seg, 'people');
  for (const junk of ['', 'settings', '../team', 'timeline/../x', undefined, null]) {
    assert.equal(parseOpenSection(junk), null, `accepted ${String(junk)}`);
  }
});

test('the section being chosen for is the one lit in the sidebar', () => {
  assert.equal(activeSection('/dashboard/projects', 'timeline'), 'timeline');
  assert.equal(activeSection('/dashboard/projects', null), null, 'the plain list lights no section');
  assert.equal(activeSection('/dashboard/projects', 'nonsense'), null);
  assert.equal(activeSection(`/dashboard/projects/${ID}/budget`, 'timeline'), 'budget', 'inside a project, the path wins');
  assert.equal(activeSection(`/dashboard/projects/${ID}`, null), '', 'Overview');
  assert.equal(activeSection('/dashboard/team', 'timeline'), null);
});

test('paths are built the same way everywhere', () => {
  assert.equal(projectSectionPath(ID, 'schedule'), `/dashboard/projects/${ID}/schedule`);
  assert.equal(projectSectionPath(ID, ''), `/dashboard/projects/${ID}`);
  assert.equal(chooserPath('budget'), '/dashboard/projects?open=budget');
  assert.equal(sectionFromPath(`/dashboard/projects/${ID}/change-orders`), 'change-orders');
});

test('every section is a real route under a project', async () => {
  // A section in the sidebar with no page behind it would be a dead link.
  const { existsSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const base = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'dashboard', 'projects', '[id]');
  for (const { seg, label } of PROJECT_SECTIONS) {
    assert.ok(existsSync(join(base, seg, 'page.tsx')), `${label} has no page at [id]/${seg}`);
  }
});
