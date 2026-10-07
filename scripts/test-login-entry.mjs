import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exercise the real sign-in page without live accounts, cookies, or databases.
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web');
const bundle = await build({
  absWorkingDir: web, entryPoints: ['src/app/page.tsx'],
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'login-entry-fixtures', setup(builder) {
    const mocks = {
      'next/navigation': 'export function redirect(url) { throw Object.assign(new Error("redirect"), {url}); }',
      '@/lib/session': `export async function getSession() { return globalThis.__loginEntry.session; }
        export const DEMO_ACCOUNTS = [];
        export function homeFor(role) { return {contractor:"/dashboard",field:"/field",client:"/portal"}[role]; }`,
      '@/lib/access': `export async function currentAccess() {
        if(globalThis.__loginEntry.failure) throw new Error("database unavailable");
        return globalThis.__loginEntry.access;
      }`,
      '@/lib/demo-accounts': 'export function demoSignInEnabled() { return false; }',
      './login-form': 'export function LoginForm() { return null; }',
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks
      ? { path: args.path, namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { default: SignInPage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
let count = 0;
async function check(name, fixture, expectedUrl, error) {
  globalThis.__loginEntry = fixture;
  let destination = null;
  let tree;
  try { tree = await SignInPage({ searchParams: Promise.resolve({ error }) }); }
  catch (thrown) { if (!thrown.url) throw thrown; destination = thrown.url; }
  assert.equal(destination, expectedUrl, name);
  if (destination === null) assert.ok(tree, `${name}: sign-in must render`);
  count++;
  return tree;
}
try {
  await check('signed out', { session: null, access: { ok: false, reason: 'signed-out' } }, null);
  for (const [role, home] of [['contractor', '/dashboard'], ['field', '/field'], ['client', '/portal']]) {
    const session = { role };
    await check(`active ${role}`, { session, access: { ok: true, access: { role, session } } }, home);
    const revoked = await check(`revoked ${role} cookie`, { session, access: { ok: false, reason: 'revoked' } }, null);
    assert.match(JSON.stringify(revoked), /no longer has access/i);
    await check(`${role} scope error`, { session, access: { ok: true, access: { role, session } } }, null, 'no-profile');
  }
  await check('changed role uses live authority', {
    session: { role: 'client' }, access: { ok: true, access: { role: 'field', session: { role: 'field' } } },
  }, '/field');
  globalThis.__loginEntry = { session: { role: 'field' }, failure: true };
  await assert.rejects(() => SignInPage({ searchParams: Promise.resolve({}) }), /database unavailable/);
  count++;
  console.log(`PASS: ${count} real sign-in-page scenarios, including revoked cookies, role changes, scope errors and fail-closed database failure. No live services accessed.`);
} finally { delete globalThis.__loginEntry; }
