import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clientProjectsFor } from './client-scope.ts';
import type { Access } from './access.ts';
import type { Project } from './data/types.ts';
import type { ProjectDataSource } from './data/source.ts';

/** Records what was asked for, so the test can assert the read path taken. */
function sourceOf(projects: Project[]) {
  const calls: { method: string; arg: unknown }[] = [];
  const source = {
    kind: 'fixture',
    async listProjectsByIds(ids: string[]) {
      calls.push({ method: 'byIds', arg: ids });
      const wanted = new Set(ids);
      return wanted.size === 0 ? [] : projects.filter((p) => wanted.has(p.buildsuiteProjectId));
    },
    async listProjectsForContact(contactId: string) {
      calls.push({ method: 'forContact', arg: contactId });
      return projects.filter((p) => p.primaryContactId === contactId);
    },
  } as unknown as ProjectDataSource;
  return { source, calls };
}

function accessOf(over: Partial<Access> & { contactId?: string }): Access {
  const { contactId, ...rest } = over;
  return {
    session: { role: 'client', name: 'A', email: 'a@example.com', contactId } as Access['session'],
    role: 'client',
    grants: {},
    invited: true,
    projectIds: null,
    can: () => true,
    ...rest,
  };
}

const PROJECTS = [
  { buildsuiteProjectId: 'p-1', primaryContactId: 'ghl-1' },
  { buildsuiteProjectId: 'p-2', primaryContactId: 'ghl-2' },
  { buildsuiteProjectId: 'p-3', primaryContactId: 'ghl-1' },
] as unknown as Project[];

test('an invited client sees exactly the projects they were ticked into', () => {
  const { source } = sourceOf(PROJECTS);
  return clientProjectsFor(accessOf({ projectIds: ['p-1', 'p-3'] }), source).then((got) => {
    assert.deepEqual(got.map((p) => p.buildsuiteProjectId), ['p-1', 'p-3']);
  });
});

test('§9.1 an invited client ticked into nothing sees nothing, not everything', async () => {
  // The failure mode that matters: an empty assignment list must never widen
  // into an unfiltered read.
  const { source, calls } = sourceOf(PROJECTS);
  assert.deepEqual(await clientProjectsFor(accessOf({ projectIds: [] }), source), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'byIds', 'it must not fall back to the contact read');
});

test('an invited client never reaches the contact read', async () => {
  // Their `contactId`, if one is ever set, must not be consulted — a membership
  // id sitting in that field is exactly the bug this replaced.
  const { source, calls } = sourceOf(PROJECTS);
  await clientProjectsFor(accessOf({ projectIds: ['p-2'], contactId: 'ghl-1' }), source);
  assert.deepEqual(calls.map((c) => c.method), ['byIds']);
});

test('a contact-linked client still gets all their projects (§1.4)', async () => {
  const { source } = sourceOf(PROJECTS);
  const got = await clientProjectsFor(accessOf({ projectIds: null, contactId: 'ghl-1' }), source);
  assert.deepEqual(got.map((p) => p.buildsuiteProjectId), ['p-1', 'p-3']);
});

test('no way to identify the person yields nothing', async () => {
  const { source, calls } = sourceOf(PROJECTS);
  assert.deepEqual(await clientProjectsFor(accessOf({ projectIds: null }), source), []);
  assert.deepEqual(await clientProjectsFor(accessOf({ projectIds: null, contactId: '  ' }), source), []);
  assert.equal(calls.length, 0, 'an unidentified reader must not reach the database at all');
});
