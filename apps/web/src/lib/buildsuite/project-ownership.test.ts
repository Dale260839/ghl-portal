import assert from 'node:assert/strict';
import test from 'node:test';

import { BuildSuiteClient } from './client.ts';
import { SupabaseReader, type BuildSuiteProjectRow } from './projects.ts';
import { BuildSuiteDataSource } from '../data/buildsuite-source.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

/**
 * Which contractor a project belongs to (Sing, 2026-09-12).
 *
 * When a project is awarded, BuildSuite writes onto THE SAME ROW: status
 * 'awarded', award_code, awarded_to_auth_profile_id, awarded_contractor_id.
 * The row keeps its id, its project_code and its client ownership
 * (`auth_profile_id`). So the contractor operating a project is
 *
 *   COALESCE(awarded_to_auth_profile_id, auth_profile_id)
 *
 * and every tenant read, and every downstream scope, has to agree on that.
 *
 * Before this file there was NO direct test of the projects tenant filter —
 * the most security-relevant filter in the reader — beyond one line in the
 * tests for the workaround this replaced.
 */

const SCOPE: TenantScope = { locationId: 'loc-1', authProfileIds: ['aps'] };

function readerOf(response: unknown = []) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(decodeURIComponent(String(url)));
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
    });
  }) as unknown as typeof fetch;
  const client = new BuildSuiteClient({ url: 'https://bs.example', key: 'k' }, { fetchImpl });
  return { urls, reader: new SupabaseReader(client, async () => ({ resolved: false, reason: 'x' })) };
}

const THE_RULE =
  'or=(awarded_to_auth_profile_id.in.(aps),and(awarded_to_auth_profile_id.is.null,auth_profile_id.in.(aps)))';

// ── The tenant filter ────────────────────────────────────────────────────────

test('a project is its WINNER\'s when awarded, its owner\'s when not', async () => {
  const { reader, urls } = readerOf();
  await reader.listProjectRows(SCOPE);
  assert.ok(urls[0]!.includes(THE_RULE), `got ${urls[0]}`);
});

test('the owner alone no longer decides once a project is awarded', async () => {
  // Chris, huddle 2026-09-10: "only the awarded contractor should retain access
  // while others are blocked". The owner clause only applies when nobody has
  // been awarded it — without `awarded_to_auth_profile_id.is.null` inside it, a
  // project owned by A and awarded to B would still list for A.
  const { reader, urls } = readerOf();
  await reader.listProjectRows(SCOPE);
  assert.match(urls[0]!, /and\(awarded_to_auth_profile_id\.is\.null,auth_profile_id\.in\./);
  assert.equal(/[?&]auth_profile_id=in\./.test(urls[0]!), false, 'a bare owner filter is back');
});

test('every tenant read of projects uses the same rule', async () => {
  // A count that disagrees with the list is how "Active Work: 4" sits above a
  // list of three.
  const { reader, urls } = readerOf();
  await reader.listProjectRows(SCOPE);
  await reader.listActiveProjects(SCOPE);
  await reader.countByStatus(SCOPE);
  assert.ok(urls.length >= 3);
  for (const url of urls) assert.ok(url.includes(THE_RULE), `a read without the rule: ${url}`);
});

test('several profiles on one tenant all count, in both clauses', async () => {
  const { reader, urls } = readerOf();
  await reader.listProjectRows({ ...SCOPE, authProfileIds: ['p1', 'p2'] });
  assert.ok(urls[0]!.includes('awarded_to_auth_profile_id.in.(p1,p2)'));
  assert.ok(urls[0]!.includes('auth_profile_id.in.(p1,p2)))'));
});

test('an unscoped read is refused before it reaches the network', async () => {
  const { reader, urls } = readerOf();
  await assert.rejects(
    () => reader.listProjectRows({ locationId: 'loc-1', authProfileIds: [] } as TenantScope),
    TenancyError,
  );
  assert.deepEqual(urls, []);
});

test('one read — no second pass looking for missing projects', async () => {
  // The workaround this replaced read proposals and then projects again. The
  // award columns make that unnecessary: the filter finds BSA-053 itself.
  const { reader, urls } = readerOf();
  await reader.listProjectRows(SCOPE);
  assert.equal(urls.length, 1);
  assert.equal(urls.some((u) => u.includes('/proposals')), false);
});

test('the award columns are read, so the screens can use them', async () => {
  const { reader, urls } = readerOf();
  await reader.listProjectRows(SCOPE);
  for (const col of ['award_code', 'awarded_to_auth_profile_id', 'awarded_contractor_id', 'project_code']) {
    assert.match(urls[0]!, new RegExp(`select=[^&]*\\b${col}\\b`), `${col} is not selected`);
  }
});

// ── Downstream: the project carries the same owner the filter used ──────────

function row(over: Partial<BuildSuiteProjectRow>): BuildSuiteProjectRow {
  return {
    id: 'p', project_code: 'BSA-053', title: 't', status: 'awarded', source: null,
    created_at: null, updated_at: null, street_address: null, city: null, state: null,
    postal_code: null, trade: null, project_type: null, budget_band: null, exact_budget: null,
    start_date: null, end_date: null, client_name: null, ghl_contact_id: null,
    ghl_opportunity_id: null, auth_profile_id: null,
    ...over,
  };
}

async function projectFrom(r: BuildSuiteProjectRow) {
  const { reader } = readerOf([r]);
  const [p] = await new BuildSuiteDataSource(reader, '').listProjects(SCOPE);
  return p!;
}

test('BSA-053: no owner, awarded to APS — its operating owner is APS', async () => {
  // Everything downstream scopes a project by `ownerAuthProfileId`. If this
  // were '' — as the raw `auth_profile_id` is — every portal read of BSA-053
  // would throw TenancyError, which is exactly what happened on 2026-09-12.
  const p = await projectFrom(row({ auth_profile_id: null, awarded_to_auth_profile_id: 'aps', award_code: 'BSA-APS-003' }));
  assert.equal(p.ownerAuthProfileId, 'aps');
  assert.equal(p.projectCode, 'BSA-053', 'the client code is untouched');
  assert.equal(p.awardCode, 'BSA-APS-003');
});

test('a self-created project: owner and winner are the same, no award code', async () => {
  const p = await projectFrom(row({
    project_code: 'BSA-APS-001', auth_profile_id: 'aps', awarded_to_auth_profile_id: 'aps', award_code: null,
  }));
  assert.equal(p.ownerAuthProfileId, 'aps');
  assert.equal(p.awardCode, null);
});

test('the winner decides even when the row names a different owner', async () => {
  const p = await projectFrom(row({ auth_profile_id: 'someone-else', awarded_to_auth_profile_id: 'aps' }));
  assert.equal(p.ownerAuthProfileId, 'aps');
});

test('an unawarded project is its owner\'s, exactly as before', async () => {
  const p = await projectFrom(row({ status: 'draft', auth_profile_id: 'aps', awarded_to_auth_profile_id: null }));
  assert.equal(p.ownerAuthProfileId, 'aps');
});
