import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayReadStaffFile } from './file-access.ts';
import { effectiveCan } from './permissions.ts';
import type { Access } from './access.ts';
import { fieldFolder } from './document-folders.ts';

function access(role: Access['role'], grants = {}): Access {
  return {
    role, session: { role, name: 'Staff', email: 'staff@example.test' },
    invited: true, projectIds: ['p1'], grants,
    can: (action, resource) => effectiveCan(role, action, resource, grants),
  };
}
const photo = { kind: 'photo' as const, category: '', projectId: 'p1' };
const document = { kind: 'document' as const, category: fieldFolder('General'), projectId: 'p1' };

test('crew may read assigned photos and field documents only', () => {
  assert.equal(mayReadStaffFile(access('field'), photo, ['p1']), true);
  assert.equal(mayReadStaffFile(access('field'), document, ['p1']), true);
  assert.equal(mayReadStaffFile(access('field'), document, ['p2']), false);
  for (const category of ['Client', 'Contract', '']) {
    assert.equal(mayReadStaffFile(access('field'), { ...document, category }, ['p1']), false);
  }
});
test('live role and resource grants narrow stale sessions', () => {
  assert.equal(mayReadStaffFile(access('field', { photo: false }), photo, ['p1']), false);
  assert.equal(mayReadStaffFile(access('contractor', { document: false }), document, ['p1']), false);
  assert.equal(mayReadStaffFile(access('client'), photo, ['p1']), false);
  assert.equal(mayReadStaffFile(access('contractor'), { ...photo, projectId: 'p2' }, []), false);
});
