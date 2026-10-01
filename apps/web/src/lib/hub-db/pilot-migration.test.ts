import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const contractor = '00000000-0000-4000-8000-000000000001';
const project = '00000000-0000-4000-8000-000000000002';
const otherProject = '00000000-0000-4000-8000-000000000003';
const update = '00000000-0000-4000-8000-000000000004';
const otherUpdate = '00000000-0000-4000-8000-000000000005';
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table hub_daily_updates (id uuid primary key, project_id uuid, contractor_id uuid, archived_at timestamptz);
    create table hub_photos (id uuid primary key, project_id uuid, contractor_id uuid);
    create table unrelated_records (id uuid primary key);
    grant all on hub_daily_updates, hub_photos to authenticated, service_role;
    grant truncate on unrelated_records to authenticated;
  `);
  for (const file of ['0019_photo_update_link.sql', '0020_upload_budget_and_photo_guards.sql', '0021_browser_truncate_revoke.sql']) {
    await db.exec(readFileSync(new URL('../../../../../supabase/hub/' + file, import.meta.url), 'utf8'));
  }
  await db.query('insert into hub_daily_updates(id, project_id, contractor_id) values ($1,$2,$3),($4,$5,$3)',
    [update, project, contractor, otherUpdate, otherProject]);
});
after(async () => { await db.close(); });
test('browser truncate revocation is Hub-only and preserves ordinary and server grants', async () => {
  const { rows } = await db.query<{ browser_truncate: boolean; browser_select: boolean; server_truncate: boolean; unrelated_truncate: boolean }>(`
    select has_table_privilege('authenticated','hub_photos','TRUNCATE') as browser_truncate,
      has_table_privilege('authenticated','hub_photos','SELECT') as browser_select,
      has_table_privilege('service_role','hub_photos','TRUNCATE') as server_truncate,
      has_table_privilege('authenticated','unrelated_records','TRUNCATE') as unrelated_truncate
  `);
  assert.deepEqual(rows[0], { browser_truncate: false, browser_select: true, server_truncate: true, unrelated_truncate: true });
  await db.exec(readFileSync(new URL('../../../../../supabase/hub/0021_browser_truncate_revoke.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('authenticated','hub_photos','TRUNCATE') as allowed")).rows[0]!.allowed, false);
});
const claim = (actor: string, bytes: number, tenant = contractor) =>
  db.query<{ result: { allowed: boolean } }>('select hub_claim_upload($1,$2,$3) as result', [tenant, actor, bytes])
    .then((result) => result.rows[0]!.result.allowed);

test('the database enforces the 60/hour ceiling across calls, not server memory', async () => {
  for (let i = 0; i < 60; i++) assert.equal(await claim('a'.repeat(64), 1), true);
  assert.equal(await claim('a'.repeat(64), 1), false);
  assert.equal(await claim('b'.repeat(64), 1), true);
});
test('daily byte ceiling covers every actor and denial rolls back the actor reservation', async () => {
  const tenant = '00000000-0000-4000-8000-000000000009';
  for (let i = 0; i < 142; i++) {
    assert.equal(await claim((i % 3).toString(16).padStart(64, 'c'), 3_500_000, tenant), true);
  }
  assert.equal(await claim('c'.repeat(64), 3_000_000, tenant), true);
  assert.equal(await claim('d'.repeat(64), 1, tenant), false);
  const result = await db.query('select * from hub_upload_budgets where contractor_id=$1 and actor_key=$2', [tenant, 'd'.repeat(64)]);
  assert.equal(result.rows.length, 0);
});
test('invalid reservations and public-role calls are refused', async () => {
  assert.equal(await claim('invalid', 1), false);
  assert.equal(await claim('e'.repeat(64), 10_000_001), false);
  await db.exec('set role anon');
  try { await assert.rejects(claim('e'.repeat(64), 1), /permission denied/); }
  finally { await db.exec('reset role'); }
});
test('the database rejects cross-project links and reassignment', async () => {
  const photo = '00000000-0000-4000-8000-000000000006';
  await db.query('insert into hub_photos(id,project_id,contractor_id,update_id) values($1,$2,$3,$4)',
    [photo, project, contractor, update]);
  await assert.rejects(db.query('update hub_photos set update_id=$1 where id=$2', [otherUpdate, photo]), /same contractor and project/);
  const next = '00000000-0000-4000-8000-000000000007';
  await db.query('insert into hub_daily_updates(id,project_id,contractor_id) values($1,$2,$3)', [next, project, contractor]);
  await assert.rejects(db.query('update hub_photos set update_id=$1 where id=$2', [next, photo]), /already linked/);
  await assert.rejects(db.query('update hub_photos set project_id=$1 where id=$2', [otherProject, photo]), /same contractor and project/);
});
