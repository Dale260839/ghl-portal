/**
 * The Hub's own database — the write path.
 *
 * RLS is currently OFF on that database (owner's decision, so policy-writing
 * does not block the build). That makes two things below load-bearing rather
 * than belt-and-braces:
 *
 *   · the key never reaches a browser
 *   · every write carries a tenant, and an unfiltered update is impossible
 *
 * If either stops being true, anything holding the key can read and write every
 * contractor's records. These are the tests that notice.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HubClient, HubWriteError, readHubConfig } from './client.ts';
import { HubRecords, ARCHIVABLE_TABLES, TABLE_LABELS } from './records.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function sourceFiles(dir: string, out: { path: string; text: string }[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.endsWith('.test.ts')) {
      out.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');

// ── The key must never reach a browser ───────────────────────────────────────

test('the Hub key is never exposed to the client bundle', () => {
  // Next.js inlines any env var prefixed NEXT_PUBLIC_ into client JavaScript.
  // With RLS off, that would hand every visitor full read and write access to
  // every contractor's records.
  const offenders = FILES.filter((f) => /NEXT_PUBLIC_HUB|NEXT_PUBLIC_SUPABASE/.test(f.text)).map(
    (f) => rel(f.path),
  );

  assert.deepEqual(offenders, [], 'a database key must never be NEXT_PUBLIC_');
});

test('the Hub client is server-only, and the guard is in the file', () => {
  const client = FILES.find((f) => rel(f.path) === 'lib/hub-db/client.ts');
  assert.ok(client);

  // `server-only` makes importing this from a client component a build error.
  // A comment saying "do not import this on the client" is not enforcement.
  assert.match(client.text, /^import 'server-only';/m);
});

test('only the Hub client module reads the Hub credentials', () => {
  // One file touches the key. Anything else wanting to write goes through the
  // client, which means the tenancy checks cannot be skipped by going around it.
  const readers = FILES.filter((f) => /HUB_SUPABASE_KEY/.test(f.text)).map((f) => rel(f.path));

  assert.deepEqual(readers, ['lib/hub-db/client.ts']);
});

// ── Writes cannot be unscoped ────────────────────────────────────────────────

/** A client whose fetch records requests instead of issuing them. */
function fakeHub(response: unknown = []) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      url: String(url),
      body: init.body === undefined ? null : JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new HubClient({ url: 'https://hub.example', key: 'test-key' }, { fetchImpl });
  return { client, calls, records: new HubRecords(client) };
}

// A contractor id AND an auth profile id, deliberately different values. They
// are different things, and a test that reuses one for the other cannot catch
// the bug where the code does the same.
const scope: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
  contractorId: '5dd312bd-0b95-45af-be7b-c19a14eff103',
};
const actor = { name: 'Marcus Reyes', role: 'contractor' };

test('an unfiltered update is refused before it reaches the network', async () => {
  // PostgREST happily PATCHes every row in a table when given no filter. This
  // is the single most destructive mistake available in this client.
  const { client, calls } = fakeHub();

  await assert.rejects(
    () => client.update({ from: 'hub_milestones', filters: {}, patch: { archived_at: 'now' } }),
    HubWriteError,
  );
  assert.deepEqual(calls, [], 'it must refuse before issuing anything');
});

test('the client has no delete method at all', () => {
  // Archive, never delete. Absence is the enforcement: a method that does not
  // exist cannot be called by mistake in a hurry.
  const surface = Object.getOwnPropertyNames(HubClient.prototype).sort();

  assert.deepEqual(surface, ['constructor', 'headers', 'insert', 'request', 'select', 'update', 'upsert']);
  assert.equal(surface.includes('delete'), false);
});

test('archiving refuses without a scope, and reaches no network', async () => {
  const { records, calls } = fakeHub();

  await assert.rejects(
    () => records.archiveRecord(null as unknown as TenantScope, 'hub_milestones', 'id-1', actor, ''),
    TenancyError,
  );
  assert.deepEqual(calls, []);
});

test('archiving filters on the contractor AND the id, never the id alone', async () => {
  // Filtering on id alone would let a guessed uuid archive another tenant's
  // record, and with RLS off the database would allow it.
  const { records, calls } = fakeHub();

  await records.archiveRecord(scope, 'hub_milestones', 'id-1', actor, 'done');

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch);
  // `eq.` and not `in.`: a contractor is ONE id. A list would be an auth
  // profile list, which is a different id and the source of the 2026-09-01 bug.
  assert.match(patch.url, /contractor_id=eq\.5dd312bd/);
  assert.match(patch.url, /id=eq\.id-1/);
});

test('archiving sets a timestamp and an author, never a delete', async () => {
  const { records, calls } = fakeHub();

  await records.archiveRecord(scope, 'hub_tasks', 'task-1', actor, 'duplicate');

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.ok(patch);
  const body = patch.body as Record<string, unknown>;
  assert.ok(typeof body.archived_at === 'string');
  assert.equal(body.archived_by, 'Marcus Reyes');
  assert.equal(calls.some((c) => c.method === 'DELETE'), false);
});

test('restoring clears the archive fields rather than writing a new row', async () => {
  const { records, calls } = fakeHub();

  await records.restoreRecord(scope, 'hub_tasks', 'task-1', actor);

  const patch = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch?.body, { archived_at: null, archived_by: null });
});

test('every archive and restore leaves an activity entry', async () => {
  // The approval model rests on being able to say who did what. An archive
  // nobody can attribute is the same problem as a delete.
  const { records, calls } = fakeHub();

  await records.archiveRecord(scope, 'hub_issues', 'issue-1', actor, 'resolved');

  const activity = calls.find((c) => c.method === 'POST' && c.url.includes('hub_activity'));
  assert.ok(activity, 'no activity row was written');
  const [row] = activity.body as Record<string, unknown>[];
  assert.equal(row.action, 'archive');
  assert.equal(row.actor, 'Marcus Reyes');
});

// ── The project overlay ──────────────────────────────────────────────────────

test('editing a project writes to the Hub, never to BuildSuite', async () => {
  const { records, calls } = fakeHub([{ project_id: 'p1', contractor_id: 'c1' }]);

  await records.editProject(scope, 'p1', 'c1', { titleOverride: 'New name' }, actor);

  for (const call of calls) {
    assert.match(call.url, /^https:\/\/hub\.example/, 'a write escaped to another host');
    assert.equal(/\/rest\/v1\/(projects|deals|proposals)\b/.test(call.url), false);
  }
});

test('an absent field is left alone; an empty one clears it', async () => {
  // Null means "defer to BuildSuite"; "" means the contractor cleared it. If
  // those collapse, clearing a title silently resurrects BuildSuite's.
  const { records, calls } = fakeHub([{ project_id: 'p1', contractor_id: 'c1' }]);

  await records.editProject(scope, 'p1', 'c1', { titleOverride: '' }, actor);

  const [row] = (calls[0].body as Record<string, unknown>[]);
  assert.equal(row.title_override, '');
  assert.equal('address_override' in row, false, 'an untouched field must not be written');
});

test('archiving a project upserts the overlay, so a first archive works', async () => {
  // Most projects have no overlay row until something is edited. A plain UPDATE
  // would silently match nothing and report success.
  const { records, calls } = fakeHub([{ project_id: 'p1' }]);

  await records.archiveProject(scope, 'p1', 'c1', actor, 'job cancelled');

  const upsert = calls.find((c) => c.method === 'POST' && c.url.includes('hub_project_state'));
  assert.ok(upsert);
  assert.match(upsert.url, /on_conflict=project_id/);
});

// ── The archive listing ──────────────────────────────────────────────────────

test('every archivable table has a human label and is listed', async () => {
  // The Archive screen shows work, not table names.
  for (const table of ARCHIVABLE_TABLES) {
    assert.ok(TABLE_LABELS[table], `${table} has no label`);
  }

  const { records, calls } = fakeHub();
  await records.listArchived(scope);

  for (const table of ARCHIVABLE_TABLES) {
    assert.ok(
      calls.some((c) => c.url.includes(table)),
      `${table} was never queried, so nothing archived in it can be restored`,
    );
  }
});

test('the archive listing asks only for archived rows, scoped to the tenant', async () => {
  const { records, calls } = fakeHub();

  await records.listArchived(scope);

  for (const call of calls) {
    assert.match(call.url, /archived_at=not\.is\.null/);
    assert.match(call.url, /contractor_id=eq\.5dd312bd/);
  }
});

// ── Configuration ────────────────────────────────────────────────────────────

test('missing configuration is reported by name, not as a crash', () => {
  const result = readHubConfig({ ...process.env, HUB_SUPABASE_URL: '', HUB_SUPABASE_KEY: '' });

  assert.equal(result.configured, false);
  assert.deepEqual(result.missing, ['HUB_SUPABASE_URL', 'HUB_SUPABASE_KEY']);
});

test('a trailing slash on the URL does not produce a double slash', () => {
  const result = readHubConfig({
    ...process.env,
    HUB_SUPABASE_URL: 'https://hub.example/',
    HUB_SUPABASE_KEY: 'k',
  });

  assert.equal(result.configured && result.config.url, 'https://hub.example');
});
