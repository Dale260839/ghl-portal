import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server.js';
import type { Session } from '../demo-accounts.ts';
const origin = 'https://hub.example.test';
const secret = 'fixture-handoff-route-secret-only-'.repeat(3);
type State = { session: (Session & { exp: number; iat: number }) | null; available: boolean;
  calls: string[]; tokens: Map<string, string>; writes: [Session, { expiresAt: number }][]; failure: boolean };

async function harness() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const mocks: Record<string, string> = {
    '@/lib/session': `export const state={session:null,available:true,calls:[],tokens:new Map(),writes:[],failure:false};
      export async function getSession(){return state.session;}
      export async function setSession(...args){state.writes.push(args);}`,
    '@/lib/access': `import {state} from '@/lib/session'; export async function currentAccess(){return state.session?
      {ok:true,access:{role:state.session.role}}:{ok:false,reason:'signed-out'};}`,
    '@/lib/hub-db/client': `import {state} from '@/lib/session'; export function getHubClient(){return state.available?
      {available:true,client:{async rpc(name,args){state.calls.push(name);if(state.failure)throw new Error('private database detail');
        if(name==='hub_create_browser_handoff'){state.tokens.set(args.p_token_hash,args.p_session_token);return;}
        const value=state.tokens.get(args.p_token_hash)??null;state.tokens.delete(args.p_token_hash);return value;}}}:
      {available:false,missing:['fixture']};}`,
  };
  const bundled = await build({ stdin: { resolveDir: root,
    contents: `export * as route from './src/app/api/auth/open-workspace/route.ts'; export {state} from '@/lib/session';` },
    absWorkingDir: root, bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['server-only','next/server'], define: { 'process.env.SESSION_SECRET': JSON.stringify(secret) },
    plugins: [{ name: 'fixture-services', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
    } }],
  });
  const module = { exports: {} };
  new Function('require','module','exports',bundled.outputFiles[0]!.text)(createRequire(import.meta.url),module,module.exports);
  return module.exports as { state: State; route: { POST: (request: NextRequest) => Promise<Response>; GET?: unknown } };
}
const source = () => ({ role: 'contractor' as const, name: 'Fixture', email: 'fixture@example.invalid',
  authProfileIds: ['fixture-profile'], ghlUserId: 'fixture-user', ghlLocationId: 'fixture-location',
  ghlIdentityVerified: true, ghlEmbedded: true, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600 });
function request(body: unknown, from: string | null = origin, contentType = 'application/json') {
  return new NextRequest(`${origin}/api/auth/open-workspace`, { method: 'POST',
    headers: { ...(from === null ? {} : { Origin: from }), 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body) });
}

test('actual HTTP handoff keeps the verified identity and returns no session claims to the browser', async () => {
  const { state, route } = await harness();
  state.session = source();
  const issue = await route.POST(request({ action: 'issue' }));
  assert.equal(issue.status, 200);
  assert.equal(issue.headers.get('cache-control'), 'no-store');
  const issued = await issue.json();
  assert.deepEqual(Object.keys(issued).sort(), ['expiresAt','token']);
  state.session = null;
  const redeemed = await route.POST(request({ action: 'redeem', token: issued.token }));
  assert.equal(redeemed.status, 200);
  assert.deepEqual(await redeemed.json(), { redirectTo: '/dashboard' });
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0]![0].ghlEmbedded, false);
  assert.deepEqual(state.writes[0]![0].authProfileIds, ['fixture-profile']);
  assert.equal((await route.POST(request({ action: 'redeem', token: issued.token }))).status, 401);
  assert.equal(route.GET, undefined);
});

test('cross-site and malformed requests never reach the session store', async () => {
  const { state, route } = await harness();
  for (const from of [null,'null','https://other.example.test',`${origin}.evil.test`]) {
    assert.equal((await route.POST(request({ action: 'issue' }, from))).status, 403);
  }
  for (const body of ['{','null','[]',JSON.stringify({ action: 'bad' }),JSON.stringify({ action: 'redeem', token: 1 }), 'x'.repeat(300)]) {
    assert.equal((await route.POST(request(body))).status, 400);
  }
  assert.equal((await route.POST(request({ action: 'issue' }, origin, 'text/plain'))).status, 400);
  assert.deepEqual(state.calls, []);
  assert.deepEqual(state.writes, []);
});

test('noncontractor, unsigned, standalone and view-as sessions cannot open a second workspace', async () => {
  const { state, route } = await harness();
  for (const session of [null,{...source(),role:'field'},{...source(),role:'client'},
    {...source(),ghlIdentityVerified:false},{...source(),ghlEmbedded:false},
    {...source(),returnTo:{role:'contractor',name:'Fixture',email:'fixture@example.invalid'}}]) {
    state.session = session as State['session'];
    assert.equal((await route.POST(request({ action: 'issue' }))).status, 401);
  }
  assert.deepEqual(state.calls, []);
});

test('outage does not create a cookie or leak details; a failed redemption is not retried', async () => {
  const { state, route } = await harness();
  state.session = source();
  state.available = false;
  assert.equal((await route.POST(request({ action: 'issue' }))).status, 503);
  state.available = true; state.failure = true;
  const response = await route.POST(request({ action: 'redeem', token: 'a'.repeat(43) }));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private database detail/);
  assert.deepEqual(state.calls, ['hub_consume_browser_handoff']);
  assert.deepEqual(state.writes, []);
});
