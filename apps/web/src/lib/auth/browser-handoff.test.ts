import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { BrowserHandoffs, canOpenWorkspace } from './browser-handoff.ts';
import { sign } from './session-crypto.ts';

const db = new PGlite();
const sql = readFileSync(new URL('../../../../../supabase/hub/0024_browser_workspace_handoffs.sql', import.meta.url), 'utf8');
const secret = 'synthetic-handoff-secret-only-'.repeat(3);
const now = () => Math.floor(Date.now() / 1000);
const session = () => ({ role: 'contractor' as const, name: 'Fixture PM', email: 'fixture@example.invalid',
  ghlIdentityVerified: true, ghlEmbedded: true, ghlLocationId: 'fixture-location', ghlUserId: 'fixture-user',
  authProfileIds: ['fixture-profile'], iat: now() - 60, exp: now() + 3600 });
const client = { async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (name === 'hub_create_browser_handoff') {
    await db.query('select hub_create_browser_handoff($1,$2,$3,$4)',
      [args.p_token_hash,args.p_owner_hash,args.p_session_token,args.p_expires_at]);
    return undefined as T;
  }
  assert.equal(name, 'hub_consume_browser_handoff');
  return (await db.query<{ result: T }>('select hub_consume_browser_handoff($1) as result', [args.p_token_hash])).rows[0]!.result;
} };
const handoffs = new BrowserHandoffs(client, secret);
before(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(sql);
});
after(async () => { await db.close(); });

test('the real SQL handoff works once, preserves scope and never extends the original session', async () => {
  const source = session();
  const issued = await handoffs.issue(source);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(issued).sort(), ['expiresAt', 'token']);
  const rows = (await db.query<{ token_hash: string; owner_hash: string }>('select * from hub_browser_handoffs')).rows;
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.token_hash, issued.token);
  assert.match(rows[0]!.token_hash, /^[a-f0-9]{64}$/);
  const opened = await handoffs.redeem(issued.token);
  assert.equal(opened?.expiresAt, source.exp);
  assert.deepEqual(opened?.session.authProfileIds, source.authProfileIds);
  assert.equal(opened?.session.ghlLocationId, source.ghlLocationId);
  assert.equal(opened?.session.ghlUserId, source.ghlUserId);
  assert.equal(opened?.session.ghlEmbedded, false);
  assert.equal(opened?.session.ghlIdentityVerified, true);
  assert.equal(await handoffs.redeem(issued.token), null);
});

test('crew, homeowner, unsigned GHL, view-as and expired sessions cannot issue a handoff', async () => {
  const source = session();
  for (const patch of [{ role: 'field' }, { role: 'client' }, { ghlIdentityVerified: false },
    { ghlEmbedded: false }, { authProfileIds: [] }, { authProfileIds: 'not-an-array' },
    { authProfileIds: [''] }, { authProfileIds: [17] }, { ghlUserId: '' }, { ghlUserId: 17 },
    { ghlLocationId: 17 },
    { returnTo: { role: 'contractor', name: 'Other', email: 'other@example.invalid' } },
    { exp: now() - 1 }, { exp: now() + 8 * 60 * 60 + 60 }]) {
    await assert.rejects(handoffs.issue({ ...source, ...patch } as typeof source), /Verified embedded/);
  }
  assert.equal(canOpenWorkspace(null), false);
  assert.equal(await handoffs.redeem('not-a-token'), null);
});

test('a fresh opening replaces older pending links and expired links do not redeem', async () => {
  const first = await handoffs.issue(session());
  const second = await handoffs.issue(session());
  assert.equal(await handoffs.redeem(first.token), null);
  await db.exec("update hub_browser_handoffs set expires_at=clock_timestamp()-interval '1 second';");
  assert.equal(await handoffs.redeem(second.token), null);
});

test('the signature, handoff purpose and original identity are checked again at redemption', async () => {
  for (const claims of [{ ...session(), purpose: 'not-a-handoff', ghlEmbedded: false },
    { ...session(), purpose: 'hub-browser-handoff', role: 'field', ghlEmbedded: false },
    { ...session(), purpose: 'hub-browser-handoff', ghlIdentityVerified: false, ghlEmbedded: false }]) {
    const issued = await handoffs.issue(session());
    await db.query('update hub_browser_handoffs set session_token=$1', [sign(claims, secret)]);
    assert.equal(await handoffs.redeem(issued.token), null);
  }
  const issued = await handoffs.issue(session());
  await db.query('update hub_browser_handoffs set session_token=$1', [sign({ ...session(), purpose: 'hub-browser-handoff' }, 'different-signing-key-'.repeat(3))]);
  assert.equal(await handoffs.redeem(issued.token), null);
});

test('database rejects excessive lifetimes; rerunning migration preserves pending links', async () => {
  await assert.rejects(client.rpc('hub_create_browser_handoff', { p_token_hash: 'a'.repeat(64),
    p_owner_hash: 'b'.repeat(64), p_session_token: 'fixture', p_expires_at: new Date(Date.now() + 180_000).toISOString() }), /Invalid browser handoff/);
  const issued = await handoffs.issue(session());
  await db.exec(sql);
  assert.ok(await handoffs.redeem(issued.token));
});

test('browser database roles cannot read, create or consume sessions; service role can', async () => {
  const issued = await handoffs.issue(session());
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role};`);
    try {
      await assert.rejects(db.query('select * from hub_browser_handoffs'), /permission denied/);
      await assert.rejects(db.query('delete from hub_browser_handoffs'), /permission denied/);
      await assert.rejects(handoffs.redeem(issued.token), /permission denied/);
      await assert.rejects(handoffs.issue(session()), /permission denied/);
    } finally { await db.exec('reset role;'); }
  }
  await db.exec('set role service_role;');
  try { assert.ok(await handoffs.redeem(issued.token)); }
  finally { await db.exec('reset role;'); }
});
