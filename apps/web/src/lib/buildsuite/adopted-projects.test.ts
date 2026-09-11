import assert from 'node:assert/strict';
import test from 'node:test';

import { BuildSuiteClient } from './client.ts';
import { SupabaseReader } from './projects.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

/**
 * Adopting ownerless projects — `listProjectRows`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 *
 * `BSA-053` is awarded, has a SIGNED proposal, and never reached the Projects
 * screen. It showed on the dashboard and opened fine when clicked, because its
 * `projects.auth_profile_id` is **null**: every project read filters on that
 * column, so an ownerless row belongs to no tenant and appears in no listing.
 * Proposals carry their own ownership, so the dashboard could see work the
 * projects list structurally could not.
 *
 * The proposal names the owner the project row is missing — `proposals.user_id`
 * — so the fix is to adopt those rows.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE TEST THAT MATTERS
 *
 * Adoption widens a TENANT READ. Every constraint below is the difference
 * between fixing one contractor's missing project and serving another
 * contractor's job to the wrong person, so each is tested on its own.
 * ---------------------------------------------------------------------------
 */

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['ap-1'],
  contractorId: 'c-1',
};

interface Call {
  url: string;
}

/**
 * The reader with a scripted fetch. `listProjectRows` makes up to three calls:
 * the owned rows, the authored proposals, then the adopted rows.
 */
function readerOf(responses: unknown[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    calls.push({ url: decodeURIComponent(String(url)) });
    return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient({ url: 'https://bs.example', key: 'k' }, { fetchImpl });
  return { calls, reader: new SupabaseReader(client, async () => ({ resolved: false, reason: 'x' })) };
}

const OWNED = { id: 'p-owned', project_code: 'BSA-001', auth_profile_id: 'ap-1' };
const ORPHAN = { id: 'p-orphan', project_code: 'BSA-053', auth_profile_id: null };

// ── It works ─────────────────────────────────────────────────────────────────

test('an ownerless project this tenant signed is listed alongside its own', async () => {
  const { reader } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.deepEqual(rows.map((r) => r.project_code), ['BSA-001', 'BSA-053']);
});

test('the proposal lookup matches on user_id, signed, and not deleted', async () => {
  const { reader, calls } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  await reader.listProjectRows(SCOPE);

  const proposalQuery = calls[1]!.url;
  assert.match(proposalQuery, /proposals\?/);
  // §3.6 — a dedicated id field. Never a name, an email or a title.
  assert.match(proposalQuery, /user_id=in\.\(ap-1\)/);
  assert.match(proposalQuery, /signature_status=eq\.SIGNED/);
  assert.match(proposalQuery, /signature_signed_at=not\.is\.null/);
  assert.match(proposalQuery, /deleted_at=is\.null/);
  // Whose, and on which project — nothing about price or document.
  assert.match(proposalQuery, /select=project_id,user_id(&|$)/);
});

// ── Constraint 1 · it never overrides an existing owner ──────────────────────

test('the adoption read demands auth_profile_id IS NULL', async () => {
  // THE constraint. Six live proposals name an author who is not the project's
  // owner — all on `BSA-001` — and without this filter that project would be
  // served to the wrong contractor. Adoption fills a gap; it never arbitrates
  // a dispute between two claims.
  const { reader, calls } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  await reader.listProjectRows(SCOPE);

  const adoptQuery = calls[2]!.url;
  assert.match(adoptQuery, /auth_profile_id=is\.null/);
  assert.match(adoptQuery, /id=in\.\(p-orphan\)/);
  assert.match(adoptQuery, /deleted_at=is\.null/);
});

test('a project owned by someone else is not adopted even when we authored a signed proposal', async () => {
  // The database enforces this through the `is.null` filter above; here the
  // fake returns nothing for the adopt query, which is what a real PostgREST
  // would do for a row whose owner is set.
  const { reader } = readerOf([[OWNED], [{ project_id: 'p-someone-elses', user_id: 'ap-1' }], []]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.deepEqual(rows.map((r) => r.id), ['p-owned']);
});

// ── Constraint 2 · only through a signed proposal ────────────────────────────

test('no signed proposal by this tenant means no extra read and no extra rows', async () => {
  // Several contractors may quote the same job. An unsigned quote is not a
  // claim of ownership, and an ownerless project with two draft proposals must
  // not land on both their screens.
  const { reader, calls } = readerOf([[OWNED], [], []]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.deepEqual(rows.map((r) => r.id), ['p-owned']);
  assert.equal(calls.length, 2, 'it must not query projects again for an empty id list');
});

// ── Constraint 3 · tenancy still applies ─────────────────────────────────────

test('a scope with no profiles reads nothing, including nothing adopted', async () => {
  const { reader, calls } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  const unscoped = { locationId: 'loc-1', authProfileIds: [] } as TenantScope;

  await assert.rejects(() => reader.listProjectRows(unscoped), TenancyError);
  assert.deepEqual(calls, [], 'an unscoped read must not reach the network');
});

test('adoption asks only about THIS tenant profiles', async () => {
  const { reader, calls } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  await reader.listProjectRows({ ...SCOPE, authProfileIds: ['ap-1', 'ap-2'] });

  assert.match(calls[1]!.url, /user_id=in\.\(ap-1,ap-2\)/);
  assert.equal(/ap-3/.test(calls[1]!.url), false);
});

// ── Shape ────────────────────────────────────────────────────────────────────

test('a project already owned is not listed twice', async () => {
  // Only possible if `auth_profile_id` stops being null between the two reads —
  // a race rather than a state, but a duplicate row on screen is worse than a
  // Set.
  const { reader } = readerOf([[OWNED], [{ project_id: 'p-owned', user_id: 'ap-1' }], [OWNED]]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.deepEqual(rows.map((r) => r.id), ['p-owned']);
});

test('a proposal with a blank project id is ignored rather than queried for', async () => {
  // An empty PostgREST `in.()` list matches nothing silently, and a blank id in
  // the middle of one changes what the filter means.
  const { reader, calls } = readerOf([[OWNED], [{ project_id: null, user_id: 'ap-1' }, { project_id: '  ', user_id: 'ap-1' }], []]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.deepEqual(rows.map((r) => r.id), ['p-owned']);
  assert.equal(calls.length, 2, 'a blank id list must not reach the projects table');
});

test('the owned read is unchanged — same filter, same order', async () => {
  // Adoption is additive. Anything it changed about the existing read would be
  // a tenancy change disguised as a bug fix.
  const { reader, calls } = readerOf([[OWNED], [], []]);
  await reader.listProjectRows(SCOPE);

  assert.match(calls[0]!.url, /auth_profile_id=in\.\(ap-1\)/);
  assert.match(calls[0]!.url, /order=updated_at\.desc/);
});

// ── The adopted row carries the owner it was missing ─────────────────────────

test('an adopted row is stamped with the profile that signed it', async () => {
  // Listing an ownerless project was not enough: every downstream read scopes
  // a project by its owner, an adopted row's owner was '', and assertScope
  // refuses a blank id. Previewing BSA-053 threw
  // "TenancyError: refusing an unscoped read of milestones" under a page that
  // still rendered. Found 2026-09-12.
  const { reader } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-1' }], [ORPHAN]]);
  const rows = await reader.listProjectRows(SCOPE);

  const adopted = rows.find((r) => r.id === 'p-orphan');
  assert.equal(adopted?.auth_profile_id, 'ap-1');
});

test('the stamp is always one of this tenant own profiles', async () => {
  // The authoring query filters `user_id` to the tenant, so the stamp cannot
  // name a profile outside it — asserted rather than assumed.
  const { reader, calls } = readerOf([[OWNED], [{ project_id: 'p-orphan', user_id: 'ap-2' }], [ORPHAN]]);
  const rows = await reader.listProjectRows({ ...SCOPE, authProfileIds: ['ap-1', 'ap-2'] });

  assert.match(calls[1]!.url, /user_id=in\.\(ap-1,ap-2\)/);
  const stamp = rows.find((r) => r.id === 'p-orphan')?.auth_profile_id;
  assert.ok(['ap-1', 'ap-2'].includes(stamp ?? ''), `stamped with ${stamp}`);
});

test('an owned row is never restamped', async () => {
  // The stamp fills a gap. A row that already names an owner keeps it — even if
  // the adopt query somehow returned it, which constraint 1 prevents.
  const alreadyOwned = { id: 'p-x', project_code: 'BSA-777', auth_profile_id: 'ap-real-owner' };
  const { reader } = readerOf([[], [{ project_id: 'p-x', user_id: 'ap-1' }], [alreadyOwned]]);
  const rows = await reader.listProjectRows(SCOPE);

  assert.equal(rows.find((r) => r.id === 'p-x')?.auth_profile_id, 'ap-real-owner');
});
