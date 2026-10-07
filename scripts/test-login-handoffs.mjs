import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../apps/web');
const source = ts.createSourceFile('actions.ts', await readFile(path.join(web, 'src/lib/actions.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const action = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'acceptInvitation');
assert.ok(action, 'The real invitation action must exist');

// Compile the actual action body, not a second implementation of its rules.
// Only its four external dependencies are fixtures; no account is created.
const compiled = ts.transpileModule(action.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let state;
const homeFor = role => ({ contractor: '/dashboard', field: '/field', client: '/portal' })[role];
const redirect = url => { throw Object.assign(new Error('redirect'), { destination: url }); };
const actionExports = {};
new Function('exports', 'getHubTeam', 'setSession', 'homeFor', 'redirect', compiled)(
  actionExports,
  () => ({ available: state.available, team: { async acceptInvite(token, password) {
    assert.equal(token, 'synthetic-token');
    assert.equal(password, 'synthetic-password-only');
    if (state.failure) throw new Error('database unavailable');
    return state.result;
  } } }),
  async session => { state.sessions.push(session); state.session = session; },
  homeFor, redirect,
);

const bundle = await build({
  absWorkingDir: web, entryPoints: ['src/lib/access.ts'], bundle: true,
  write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'handoff-boundaries', setup(builder) {
    const mocks = {
      'server-only': '',
      'next/navigation': 'export function redirect(url) { throw Object.assign(new Error("redirect"), {destination:url}); }',
      './session.ts': 'export async function getSession() { return globalThis.__handoff.session; }',
      './hub-db/team.ts': `export function getHubTeam() { const s=globalThis.__handoff;
        return {available:s.available,team:{async currentAccess(id) {
          s.reads++; if(s.failure) throw new Error('database unavailable');
          if(s.current === null) return null;
          if(id !== s.current.membership.id) throw new Error('wrong membership requested');
          return s.current;
        }}};
      }`,
    };
    builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'fixture' } : undefined);
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path] }));
  } }],
});
const { currentAccess, requireAccess } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);
let count = 0;
function fixture(overrides = {}) {
  state = { available: true, sessions: [], session: null, reads: 0, current: null, ...overrides };
  globalThis.__handoff = state;
}
async function accept() {
  const form = new FormData();
  form.set('token', 'synthetic-token');
  form.set('password', 'synthetic-password-only');
  try { await actionExports.acceptInvitation(form); }
  catch (error) { if (error.destination) return error.destination; throw error; }
  assert.fail('An invitation must finish with a redirect');
}
const member = role => ({ id: 'fixture-member', role, email: 'fixture@example.invalid', fullName: '',
  authProfileIds: role === 'field' ? ['fixture-profile'] : [], projectIds: ['fixture-project'] });

try {
  for (const role of ['field', 'client']) {
    const membership = member(role);
    fixture({ result: { ok: true, membership }, current: { membership, grants: {} } });
    assert.equal(await accept(), homeFor(role));
    assert.equal(state.sessions.length, 1);
    assert.equal(state.session.name, membership.email);
    assert.deepEqual(state.session.authProfileIds, membership.authProfileIds);
    assert.equal(state.session.contactId, undefined);
    const access = await requireAccess();
    assert.equal(access.role, role);
    assert.deepEqual(access.projectIds, ['fixture-project']);
    assert.equal(access.can('publish', 'dailyUpdate'), false);
    count++;

    state.current.membership = { ...membership, projectIds: [] };
    assert.deepEqual((await requireAccess()).projectIds, [], 'Removing assignments takes effect on the next request');
    count++;
    state.current = null;
    await assert.rejects(requireAccess, error => error.destination === '/?error=access-revoked');
    count++;
  }
  for (const reason of ['invalid', 'expired', 'already-used', 'revoked', 'weak-password']) {
    fixture({ result: { ok: false, reason } });
    assert.equal(await accept(), `/invite/synthetic-token?error=${reason}`);
    assert.deepEqual(state.sessions, []);
    count++;
  }
  for (const overrides of [{ available: false }, { failure: true }]) {
    fixture(overrides);
    await assert.rejects(accept, /database/);
    assert.deepEqual(state.sessions, []);
    count++;
  }
  fixture();
  assert.deepEqual(await currentAccess(), { ok: false, reason: 'signed-out' });
  assert.equal(state.reads, 0);
  count++;
  fixture({ session: { role: 'contractor', authProfileIds: ['fixture-profile'] } });
  assert.equal((await requireAccess()).can('publish', 'dailyUpdate'), true);
  assert.equal(state.reads, 0, 'GHL contractors do not require an invited membership');
  count++;
  fixture({ session: { role: 'field', membershipId: 'fixture-member' }, current: { membership: member('client'), grants: { invoice: true } } });
  assert.equal((await requireAccess()).role, 'client', 'Current membership overrides a stale cookie role');
  assert.equal((await requireAccess()).can('read', 'invoice'), false, 'A grant cannot exceed the role');
  count++;
  state.available = false;
  assert.deepEqual(await currentAccess(), { ok: false, reason: 'revoked' });
  count++;
  state.available = true;
  state.failure = true;
  await assert.rejects(requireAccess, /database unavailable/);
  count++;
  console.log(`PASS: ${count} actual invitation-action/access handoff checks. Fixture services only; no live invitations, credentials or records changed.`);
} finally { delete globalThis.__handoff; }
