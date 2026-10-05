import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sign } from './session-crypto.ts';

const SECRET = 'fixture-only-sign-out-session-secret-not-live';
const ORIGIN = 'https://hub.example.test';
type CookieOptions = Record<string, unknown>;
type Harness = {
  route: { POST: (request: unknown) => Promise<Response>; GET?: unknown };
  state: { token?: string; writes: [string, string, CookieOptions][] };
  SignOutForm: (props: { children: null }) => { props: { action: string; method: string } };
};

async function harness(): Promise<Harness> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const output = await build({
    stdin: { contents: `export * as route from './src/app/api/auth/sign-out/route.ts';
      export { SignOutForm } from './src/components/sign-out-form.tsx';
      export { state } from 'next/headers';`, resolveDir: root },
    absWorkingDir: root, bundle: true, write: false, platform: 'node',
    format: 'cjs', jsx: 'automatic', external: ['next/server', 'server-only'],
    define: {
      'process.env': JSON.stringify({ NODE_ENV: 'production', SESSION_SECRET: SECRET }),
    },
    plugins: [{ name: 'cookie-fixture', setup(builder) {
      builder.onResolve({ filter: /^next\/headers$/ }, () => ({ path: 'cookies', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: `export const state = { token: undefined, writes: [] };
          export async function cookies(){return {
            get:()=>state.token ? {value:state.token} : undefined,
            set:(...args)=>state.writes.push(args)
          };}`, loader: 'js',
      }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0]!.text)(
    createRequire(import.meta.url), module, module.exports,
  );
  return module.exports as Harness;
}

function request(origin: string | null = ORIGIN) {
  return { nextUrl: new URL(`${ORIGIN}/api/auth/sign-out?next=https://outside.invalid`),
    headers: new Headers(origin === null ? {} : { origin }) };
}

test('sign-out uses a stable native POST, not a deployment-specific server action', async () => {
  const { SignOutForm, route } = await harness();
  assert.equal(SignOutForm({ children: null }).props.action, '/api/auth/sign-out');
  assert.equal(SignOutForm({ children: null }).props.method, 'post');
  assert.equal(route.GET, undefined, 'a navigation or prefetch must not sign anyone out');
});

test('sign-out expires the correct cookie for ordinary and embedded sessions', async () => {
  for (const embedded of [false, true]) {
    const { route, state } = await harness();
    state.token = sign({ role: 'contractor', ghlEmbedded: embedded, ghlIdentityVerified: true }, SECRET);
    const response = await route.POST(request());
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${ORIGIN}/`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(state.writes, [['bs_session_hub', '', {
      maxAge: 0, path: '/', httpOnly: true, secure: true,
      sameSite: embedded ? 'none' : 'lax', partitioned: embedded,
    }]]);
  }
});

test('sign-out refuses missing, opaque, cross-site and sibling-subdomain origins without clearing a session', async () => {
  const { route, state } = await harness();
  for (const origin of [null, 'null', 'https://outside.invalid', 'https://other.example.test', `${ORIGIN}.evil.test`]) {
    assert.equal((await route.POST(request(origin))).status, 403);
  }
  assert.deepEqual(state.writes, []);
});

test('sign-out is idempotent when already signed out', async () => {
  const { route, state } = await harness();
  assert.equal((await route.POST(request())).status, 303);
  assert.equal((await route.POST(request())).status, 303);
  assert.equal(state.writes.length, 2);
});
