import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubMedia } from './media.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

function recording() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async insert(args: Record<string, unknown>) {
      calls.push({ op: 'insert', args });
      return [{ id: 'n1', project_id: 'p1', storage_path: null, external_url: null, client_visible: false, uploaded_by: 'A', created_at: 'now' }];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { calls, media: new HubMedia(client as never) };
}

const FILE = { projectId: 'p1', label: 'Permit', storagePath: 'c/p/documents/x.pdf' };

test('§ every read and write is filtered on the asserted contractor', async () => {
  const { calls, media } = recording();
  await media.listForProject(SCOPE, 'document', 'p1');
  await media.update(SCOPE, 'photo', 'i1', { clientVisible: true });

  assert.equal((calls[0]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
  assert.equal((calls[1]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
});

test('§ a scope with no contractor writes nothing', async () => {
  const { media } = recording();
  const none: TenantScope = { locationId: 'loc-1', authProfileIds: ['p'] };

  await assert.rejects(() => media.listForProject(none, 'document', 'p1'), TenancyError);
  await assert.rejects(() => media.attach(none, 'document', FILE, { name: 'A' }), TenancyError);
});

test('a row must point at something openable', async () => {
  // A listing entry that opens nothing reads as a lost file, which is worse
  // than no entry at all.
  const { media } = recording();
  await assert.rejects(
    () => media.attach(SCOPE, 'document', { projectId: 'p1', label: 'x' }, { name: 'A' }),
    /either an uploaded path or a link/i,
  );
});

test('a link must actually be a link', async () => {
  const { media } = recording();
  for (const bad of ['not a url', 'ftp://x/y', '/relative']) {
    await assert.rejects(
      () => media.attach(SCOPE, 'document', { projectId: 'p1', label: 'x', externalUrl: bad }, { name: 'A' }),
      /http\(s\) URL/i,
    );
  }
});

test('a document needs a title; a photo does not need a caption', async () => {
  const { media } = recording();
  await assert.rejects(
    () => media.attach(SCOPE, 'document', { ...FILE, label: '  ' }, { name: 'A' }),
    /needs a title/i,
  );
  // A photo with no caption is a normal thing a crew member uploads.
  await media.attach(SCOPE, 'photo', { ...FILE, label: '' }, { name: 'A' });
});

test('a new file is internal until someone releases it', async () => {
  const { calls, media } = recording();
  await media.attach(SCOPE, 'document', FILE, { name: 'Ralph' });

  const row = (calls[0]!.args.rows as Record<string, unknown>[])[0]!;
  assert.equal(row.client_visible, false);
  assert.equal(row.contractor_id, 'contractor-1');
  assert.equal(row.uploaded_by, 'Ralph');
});

test('documents and photos write to their own tables and columns', async () => {
  const { calls, media } = recording();
  await media.attach(SCOPE, 'document', FILE, { name: 'A' });
  await media.attach(SCOPE, 'photo', { ...FILE, label: 'Site' }, { name: 'A' });

  assert.equal(calls[0]!.args.from, 'hub_documents');
  assert.equal((calls[0]!.args.rows as Record<string, unknown>[])[0]!.title, 'Permit');
  assert.equal(calls[1]!.args.from, 'hub_photos');
  assert.equal((calls[1]!.args.rows as Record<string, unknown>[])[0]!.caption, 'Site');
});

test('un-releasing a file reaches the database as false', async () => {
  const { calls, media } = recording();
  await media.update(SCOPE, 'document', 'i1', { clientVisible: false });

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('an edit with nothing in it does not touch the database', async () => {
  const { calls, media } = recording();
  await media.update(SCOPE, 'photo', 'i1', {});
  assert.equal(calls.length, 0);
});

test('archived files never appear in a list', async () => {
  const { calls, media } = recording();
  await media.listForProject(SCOPE, 'photo', 'p1');
  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

test('removal archives the ROW and leaves the file in the bucket', async () => {
  // Deleting the object would break any signed URL already in a homeowner's
  // hands, and HubClient has no delete method at all.
  const { calls, media } = recording();
  await media.archive(SCOPE, 'document', 'i1', { name: 'Ralph' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.op, 'update');
  assert.equal(calls[0]!.args.from, 'hub_documents');
  assert.equal((calls[0]!.args.patch as Record<string, unknown>).archived_by, 'Ralph');
});
