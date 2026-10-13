import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const executable = process.env.HUB_TEST_PSQL;
const socket = process.env.HUB_TEST_PG_SOCKET;
if (!executable || !socket?.startsWith('/tmp/project-hub-reset-audit-')) {
  throw new Error('This test requires an explicitly configured isolated local PostgreSQL socket. Never use production.');
}
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-A', '-t', '-h', socket, '-p', '55483', '-U', 'postgres', '-d', 'postgres'];
function query(sql) {
  const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const first = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('"ok": true') || stdout.includes('fixture-signed-session')) resolve(); });
    child.on('error', reject);
  });
  const done = new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  });
  child.stdin.end(`set statement_timeout='5s';\n${sql}`);
  return { first, done };
}
const contractor = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const hash = n => n.toString(16).padStart(64, '0');
const pw = `scrypt$16384$${'a'.repeat(32)}$${'b'.repeat(128)}`;
const redeem = n => `select hub_redeem_invitation('${hash(n)}','${contractor}','fixture@example.invalid','${pw}');`;
await query(`create role anon; create role authenticated; create role service_role bypassrls;
  create table hub_memberships(id uuid primary key,contractor_id uuid not null,email text not null,role text not null,
    password_hash text,activated_at timestamptz,revoked_at timestamptz,updated_at timestamptz);
  create table hub_invitations(id uuid primary key default gen_random_uuid(),membership_id uuid,contractor_id uuid not null,
    email text not null,role text not null,token_hash text unique not null,expires_at timestamptz not null,
    accepted_at timestamptz,revoked_at timestamptz);
  grant all on hub_memberships,hub_invitations to service_role;
  ${await readFile(new URL('../supabase/hub/0023_atomic_credential_redemption.sql', import.meta.url), 'utf8')}
  ${await readFile(new URL('../supabase/hub/0024_browser_workspace_handoffs.sql', import.meta.url), 'utf8')}`).done;
async function fixture(tokens) {
  await query(`truncate hub_invitations,hub_memberships;
    insert into hub_memberships(id,contractor_id,email,role,password_hash) values('${member}','${contractor}','fixture@example.invalid','field','old');
    insert into hub_invitations(membership_id,contractor_id,email,role,token_hash,expires_at) values
    ${tokens.map(n => `('${member}','${contractor}','fixture@example.invalid','field','${hash(n)}',clock_timestamp()+interval '1 hour')`).join(',')};`).done;
}
for (const [tokens, secondToken, expected] of [[[1],1,'already-used'], [[2,3],3,'revoked']]) {
  await fixture(tokens);
  const a = query(`begin; ${redeem(tokens[0])} select pg_sleep(0.8); commit;`);
  await a.first;
  const b = query(redeem(secondToken));
  const [one,two] = await Promise.all([a.done,b.done]);
  assert.match(one, /"ok": true/);
  assert.match(two, new RegExp(`"reason": "${expected}"`));
  assert.match(await query('select credential_version from hub_memberships;').done, /\n1$/);
}
await fixture([4]);
const rollback = query(`begin; ${redeem(4)} select pg_sleep(0.8); rollback;`);
await rollback.first;
const afterRollback = query(redeem(4));
assert.match((await Promise.all([rollback.done,afterRollback.done]))[1], /"ok": true/);
assert.match(await query('select credential_version from hub_memberships;').done, /\n1$/);

await fixture([5]);
const burst = await Promise.all(Array.from({ length: 20 }, () => query(redeem(5)).done));
assert.equal(burst.filter(output => output.includes('"ok": true')).length, 1);
assert.equal(burst.filter(output => output.includes('"reason": "already-used"')).length, 19);

await query(`select hub_create_browser_handoff('${hash(6)}','${hash(7)}','fixture-signed-session',clock_timestamp()+interval '90 seconds');`).done;
const a = query(`begin; select hub_consume_browser_handoff('${hash(6)}'); select pg_sleep(0.8); commit;`);
await a.first;
const b = query(`select coalesce(hub_consume_browser_handoff('${hash(6)}'),'already-consumed');`);
const [first,second] = await Promise.all([a.done,b.done]);
assert.match(first, /fixture-signed-session/);
assert.match(second, /already-consumed/);
console.log('PASS: real PostgreSQL connections contend on one reset link, different reset links, transaction rollback, a 20-connection reset burst and a one-time browser handoff. Synthetic isolated database only.');
