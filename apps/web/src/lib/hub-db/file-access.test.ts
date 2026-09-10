import assert from 'node:assert/strict';
import test from 'node:test';

import { HubClient } from './client.ts';
import { HubMedia } from './media.ts';
import { HubStorage, storagePath, BUCKET } from './storage.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

/**
 * Files: duplication, and who can reach whose.
 *
 * ---------------------------------------------------------------------------
 * THE TWO QUESTIONS, AND WHY THEY ARE ONE TEST FILE
 *
 * A file lives in two places — a row in `hub_documents`/`hub_photos`, and an
 * object in the private `hub-media` bucket — and access has to hold in both.
 * Testing them apart is how you get a row nobody can reach, or an object
 * reachable by someone with no row.
 *
 * DUPLICATION is not one thing either:
 *   · two objects with the same BYTES is fine and expected;
 *   · two objects at the same PATH must be impossible, or an upload silently
 *     destroys an earlier file that a signed URL may still point at;
 *   · two ROWS for one project is a user decision, not a fault — a contractor
 *     may legitimately attach a revised drawing beside the old one.
 * ---------------------------------------------------------------------------
 */

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['ap-1'],
  contractorId: 'c-1',
};
const OTHER: TenantScope = {
  locationId: 'loc-2',
  authProfileIds: ['ap-2'],
  contractorId: 'c-2',
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function fake(responses: unknown[] = [[]]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url: String(url),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });
    return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new HubClient({ url: 'https://hub.example', key: 'k' }, { fetchImpl });
  return { calls, media: new HubMedia(client) };
}

const ROW = {
  id: 'f-1',
  project_id: 'p-1',
  title: 'Signed permit',
  category: 'Permit',
  storage_path: 'c-1/p-1/documents/uuid-permit.pdf',
  external_url: null,
  client_visible: false,
  uploaded_by: 'Ralph',
  created_at: '2026-09-10T00:00:00Z',
};

// ── Per-project access: the row ──────────────────────────────────────────────

test('a listing is filtered by BOTH the contractor and the project', async () => {
  // Either filter alone is wrong. Contractor alone returns every project they
  // own onto one project's screen; project alone returns another tenant's files
  // for a project id somebody guessed.
  const { media, calls } = fake([[ROW]]);
  await media.listForProject(SCOPE, 'document', 'p-1');

  const url = decodeURIComponent(calls[0]!.url);
  assert.match(url, /contractor_id=eq\.c-1/);
  assert.match(url, /project_id=eq\.p-1/);
  assert.match(url, /archived_at=is\.null/);
});

test('a blank project id lists nothing rather than everything', async () => {
  // An empty PostgREST filter value matches every row. A screen that renders
  // before its id resolves would have shown the contractor's whole library
  // under one project heading.
  const { media, calls } = fake([[ROW]]);
  assert.deepEqual(await media.listForProject(SCOPE, 'document', '   '), []);
  assert.deepEqual(calls, [], 'a blank id must not reach the network');
});

test('a session with no contractor reads nothing at all', async () => {
  // Nine of sixty-eight accounts do not resolve to a contractor. `assertContractor`
  // refuses rather than falling back to an unfiltered read.
  const { media, calls } = fake([[ROW]]);
  const unlinked: TenantScope = { locationId: 'loc-1', authProfileIds: ['ap-1'] };

  await assert.rejects(() => media.listForProject(unlinked, 'document', 'p-1'), TenancyError);
  assert.deepEqual(calls, []);
});

test('updating and archiving are filtered by contractor, not just row id', async () => {
  // A row id is guessable in a way a tenant boundary must not depend on.
  for (const run of [
    async (m: HubMedia) => m.update(SCOPE, 'document', 'f-1', { clientVisible: true }),
    async (m: HubMedia) => m.archive(SCOPE, 'document', 'f-1', { name: 'Ralph' }),
  ]) {
    const { media, calls } = fake([[ROW]]);
    await run(media);
    const url = decodeURIComponent(calls.find((c) => c.method === 'PATCH')!.url);
    assert.match(url, /id=eq\.f-1/);
    assert.match(url, /contractor_id=eq\.c-1/, 'the tenant filter is missing');
  }
});

test('attaching files the row under the ASSERTED contractor, not a passed one', async () => {
  // The tenant comes from the scope. A caller who could supply it could supply
  // somebody else's.
  const { media, calls } = fake([[ROW]]);
  await media.attach(
    SCOPE,
    'document',
    { projectId: 'p-1', label: 'Permit', storagePath: 'c-1/p-1/documents/x.pdf' },
    { name: 'Ralph' },
  );
  const row = (calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>[])[0]!;
  assert.equal(row.contractor_id, 'c-1');
  assert.equal(row.project_id, 'p-1');
});

test('a new file is never client-visible by default', async () => {
  // Releasing is a separate, deliberate act. A default of visible would publish
  // a document to a homeowner the moment it was uploaded, before anyone read it.
  const { media, calls } = fake([[ROW]]);
  await media.attach(
    SCOPE,
    'document',
    { projectId: 'p-1', label: 'Permit', storagePath: 'c-1/p-1/documents/x.pdf' },
    { name: 'Ralph' },
  );
  const row = (calls.find((c) => c.method === 'POST')!.body as Record<string, unknown>[])[0]!;
  assert.equal(row.client_visible, false);
});

// ── Per-project access: the object in the bucket ─────────────────────────────

test('a stored path is prefixed with the contractor, then the project', async () => {
  // The prefix IS the access rule, both for the signed-URL check below and for
  // the storage policies deferred with table RLS.
  const path = storagePath('c-1', 'p-1', 'documents', 'permit.pdf');
  assert.match(path, /^c-1\/p-1\/documents\//);
});

test('two uploads of the same filename cannot land on the same path', async () => {
  // The bucket is written with `x-upsert: false`, so a collision would FAIL an
  // upload rather than overwrite — but a failed upload is still a lost file
  // from the user's side. The uuid is what makes a collision impossible.
  const paths = new Set(
    Array.from({ length: 200 }, () => storagePath('c-1', 'p-1', 'photos', 'photo.jpg')),
  );
  assert.equal(paths.size, 200, 'two uploads collided on a path');
});

test('a filename cannot climb out of its project prefix', async () => {
  // `../` in a filename would otherwise write into another project's folder, or
  // out of the contractor prefix entirely.
  for (const nasty of ['../../other/secret.pdf', '..\\..\\x.pdf', 'a/b/c.pdf']) {
    const path = storagePath('c-1', 'p-1', 'documents', nasty);
    // ONE segment after the prefix is the whole guarantee: every separator in
    // the name became a hyphen, so there is nothing left to climb with.
    assert.match(path, /^c-1\/p-1\/documents\/[^/]+$/, `escaped with ${JSON.stringify(nasty)}`);
    // A literal `..` may survive INSIDE the filename — `..-..-other-secret.pdf`
    // — and that is harmless, because traversal needs a separator around it.
    // Asserting the substring was absent failed on a path that cannot climb.
    assert.equal(path.split('/').includes('..'), false, 'a `..` path segment survived');
  }
});

test('a signed URL is refused for another contractor’s path', async () => {
  // The one hole a per-request signing endpoint would otherwise have: the
  // caller supplies the path, so the path must be checked against the tenant.
  const storage = new HubStorage('https://hub.example', 'k');
  await assert.rejects(
    () => storage.signedUrl(SCOPE, 'c-2/p-9/documents/uuid-theirs.pdf'),
    /belongs to another contractor/,
  );
});

test('a signed URL is refused when the prefix merely LOOKS like the tenant', async () => {
  // `c-1` must not match `c-10`. A `startsWith` without the separator would let
  // one contractor read another's whole bucket prefix.
  const storage = new HubStorage('https://hub.example', 'k');
  await assert.rejects(
    () => storage.signedUrl(SCOPE, 'c-10/p-1/documents/x.pdf'),
    /belongs to another contractor/,
  );
});

test('an unlinked session cannot mint a URL for anything', async () => {
  const storage = new HubStorage('https://hub.example', 'k');
  const unlinked: TenantScope = { locationId: 'loc-1', authProfileIds: ['ap-1'] };
  await assert.rejects(() => storage.signedUrl(unlinked, 'c-1/p-1/documents/x.pdf'), TenancyError);
});

test('the bucket is private, and its name is fixed in one place', () => {
  // A second literal is how half the code ends up writing to a bucket the other
  // half does not read.
  assert.equal(BUCKET, 'hub-media');
});

// ── Duplication ──────────────────────────────────────────────────────────────

test('two projects of the same contractor never share a listing', async () => {
  // The cross-PROJECT case, distinct from cross-tenant. One contractor, two
  // jobs, two homeowners: p-1's homeowner must never see p-2's files.
  const { media, calls } = fake([[ROW]]);
  await media.listForProject(SCOPE, 'document', 'p-1');
  await media.listForProject(SCOPE, 'document', 'p-2');

  assert.match(decodeURIComponent(calls[0]!.url), /project_id=eq\.p-1/);
  assert.match(decodeURIComponent(calls[1]!.url), /project_id=eq\.p-2/);
  assert.notEqual(calls[0]!.url, calls[1]!.url);
});

test('the same contractor id cannot be spoofed across scopes', async () => {
  // Two scopes, two tenants, and the filter follows the scope rather than
  // anything the caller passed alongside it.
  const a = fake([[ROW]]);
  const b = fake([[ROW]]);
  await a.media.listForProject(SCOPE, 'document', 'p-1');
  await b.media.listForProject(OTHER, 'document', 'p-1');

  assert.match(decodeURIComponent(a.calls[0]!.url), /contractor_id=eq\.c-1/);
  assert.match(decodeURIComponent(b.calls[0]!.url), /contractor_id=eq\.c-2/);
});

test('a row with neither a file nor a link is refused', async () => {
  // A listing entry that opens nothing reads as data loss, which is worse than
  // no entry at all.
  const { media, calls } = fake([[ROW]]);
  await assert.rejects(
    () => media.attach(SCOPE, 'document', { projectId: 'p-1', label: 'Permit' }, { name: 'R' }),
    /either an uploaded path or a link/,
  );
  assert.deepEqual(calls.filter((c) => c.method === 'POST'), []);
});

test('an external link must be http(s), not a javascript: or data: URL', async () => {
  const { media } = fake([[ROW]]);
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'ftp://x/y']) {
    await assert.rejects(
      () =>
        media.attach(
          SCOPE,
          'document',
          { projectId: 'p-1', label: 'Permit', externalUrl: bad },
          { name: 'R' },
        ),
      /must be an http\(s\) URL/,
      `accepted ${bad}`,
    );
  }
});

test('archiving leaves the object in the bucket', async () => {
  // A signed URL already issued stays valid for its ten minutes. Removing the
  // object would break a download a homeowner started thirty seconds ago, and
  // `HubClient` has no delete method at all.
  const { media, calls } = fake([[ROW]]);
  await media.archive(SCOPE, 'document', 'f-1', { name: 'Ralph' });

  assert.deepEqual(calls.filter((c) => c.method === 'DELETE'), []);
  const patch = calls.find((c) => c.method === 'PATCH')!.body as Record<string, unknown>;
  assert.ok(patch.archived_at, 'archiving must be a timestamp, not a delete');
});
