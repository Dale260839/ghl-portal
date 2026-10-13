import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../../../../../supabase/hub/0023_atomic_credential_redemption.sql', import.meta.url), 'utf8');
const contractor = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const hash = (n: number) => n.toString(16).padStart(64, '0');
const password = `scrypt$16384$${'a'.repeat(32)}$${'b'.repeat(128)}`;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table hub_memberships(id uuid primary key, contractor_id uuid not null, email text not null,
      role text not null, password_hash text, activated_at timestamptz, revoked_at timestamptz, updated_at timestamptz);
    create table hub_invitations(id uuid primary key default gen_random_uuid(), membership_id uuid,
      contractor_id uuid not null, email text not null, role text not null, token_hash text unique not null,
      expires_at timestamptz not null, accepted_at timestamptz, revoked_at timestamptz);
    alter table hub_memberships enable row level security; alter table hub_invitations enable row level security;
    grant all on hub_memberships, hub_invitations to service_role;`);
  await db.exec(migration);
});
after(async () => { await db.close(); });
async function fixture(n: number) {
  await db.exec('truncate hub_invitations,hub_memberships;');
  await db.query(`insert into hub_memberships(id,contractor_id,email,role,password_hash,activated_at)
    values($1,$2,'fixture@example.invalid','field','old', '2026-09-01T00:00:00Z')`, [memberId, contractor]);
  await db.query(`insert into hub_invitations(membership_id,contractor_id,email,role,token_hash,expires_at)
    values($1,$2,'fixture@example.invalid','field',$3,clock_timestamp()+interval '1 hour')`, [memberId, contractor, hash(n)]);
}
async function redeem(n: number, tenant = contractor, email = 'fixture@example.invalid', pw = password) {
  return (await db.query<{ result: { ok: boolean; reason?: string; membership?: Record<string, unknown> } }>(
    'select hub_redeem_invitation($1,$2,$3,$4) as result', [hash(n), tenant, email, pw])).rows[0]!.result;
}
async function current() { return (await db.query<{ password_hash: string; activated_at: string; credential_version: number }>('select * from hub_memberships')).rows[0]!; }

test('one transaction changes the password, consumes the link and increments the session version', async () => {
  await fixture(1);
  const result = await redeem(1);
  assert.equal(result.ok, true);
  assert.equal(result.membership?.credential_version, 1);
  assert.equal(result.membership?.password_hash, undefined);
  assert.equal((await current()).password_hash, password);
  assert.equal(new Date(String((await current()).activated_at)).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.deepEqual(await redeem(1), { ok: false, reason: 'already-used' });
  assert.equal((await current()).credential_version, 1);
});

test('a failed token-consumption write rolls back the password and version too', async () => {
  await fixture(2);
  await db.exec(`create function fixture_fail() returns trigger language plpgsql as $$
    begin raise exception 'synthetic consumption failure'; end; $$;
    create trigger fixture_fail before update on hub_invitations for each row execute function fixture_fail();`);
  try {
    await assert.rejects(redeem(2), /synthetic consumption failure/);
    assert.equal((await current()).password_hash, 'old');
    assert.equal((await current()).credential_version, 0);
    assert.equal((await db.query<{ accepted_at: string | null }>('select accepted_at from hub_invitations')).rows[0]!.accepted_at, null);
  } finally { await db.exec('drop trigger fixture_fail on hub_invitations; drop function fixture_fail();'); }
  assert.equal((await redeem(2)).ok, true, 'failed transaction did not spend the link');
});

test('invalid tenant, email, role, missing row and malformed password cannot mutate credentials', async () => {
  await fixture(3);
  for (const request of [redeem(99), redeem(3, '33333333-3333-4333-8333-333333333333'),
    redeem(3, contractor, 'other@example.invalid'), redeem(3, contractor, 'fixture@example.invalid', 'short')]) {
    assert.deepEqual(await request, { ok: false, reason: 'invalid' });
  }
  await db.exec("update hub_memberships set role='client';");
  assert.deepEqual(await redeem(3), { ok: false, reason: 'invalid' });
  assert.equal((await current()).password_hash, 'old');
});

test('expiry uses database time and both invitation and membership revocation close the door', async () => {
  for (const target of ['hub_invitations', 'hub_memberships']) {
    await fixture(4);
    await db.exec(`update ${target} set revoked_at=clock_timestamp();`);
    assert.deepEqual(await redeem(4), { ok: false, reason: 'revoked' });
    assert.equal((await current()).password_hash, 'old');
  }
  await fixture(4);
  await db.exec("update hub_invitations set expires_at=clock_timestamp()-interval '1 second';");
  assert.deepEqual(await redeem(4), { ok: false, reason: 'expired' });
});

test('successful redemption revokes other outstanding links for the same member', async () => {
  await fixture(5);
  await db.query(`insert into hub_invitations select gen_random_uuid(),membership_id,contractor_id,email,role,$1,
    expires_at,null,null from hub_invitations`, [hash(6)]);
  assert.equal((await redeem(5)).ok, true);
  assert.deepEqual(await redeem(6), { ok: false, reason: 'revoked' });
});

test('metadata changes cannot increment or reset credential version; migration rerun preserves it', async () => {
  await fixture(7);
  await redeem(7);
  await db.exec("update hub_memberships set email='fixture@example.invalid',credential_version=99;");
  assert.equal((await current()).credential_version, 1);
  await db.exec(migration);
  assert.equal((await current()).credential_version, 1);
});

test('only the server role can redeem credentials', async () => {
  await fixture(8);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`);
    try { await assert.rejects(redeem(8), /permission denied/); }
    finally { await db.exec('reset role;'); }
  }
  await db.exec('set role service_role;');
  try { assert.equal((await redeem(8)).ok, true); }
  finally { await db.exec('reset role;'); }
});
