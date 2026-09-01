/**
 * Access — what the signed-in person may see, right now.
 *
 * The behaviour worth defending is that **revocation is immediate**. A session
 * lasts eight hours; if access were baked into the cookie, "revoke" would mean
 * "revoke tomorrow", which is not what the button says.
 *
 * These test the rule rather than the plumbing, so they exercise `effectiveCan`
 * with the grant shapes `currentAccess` produces.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { effectiveCan } from './permissions.ts';

const LIB = dirname(fileURLToPath(import.meta.url));
const source = (name: string) => readFileSync(join(LIB, name), 'utf8');

// ── The rule that makes revocation mean something ───────────────────────────

test('access is re-read per request, not cached in the session', () => {
  // If grants or the role were stored in the cookie, unticking a resource or
  // revoking someone would not take effect until their next login — up to eight
  // hours later. This asserts the lookup is still there.
  const access = source('access.ts');

  assert.match(access, /currentAccess\(membershipId\)/, 'the membership must be re-read');
  assert.doesNotMatch(
    access,
    /session\.grants|session\.role\s*===\s*['"]/,
    'grants and role must come from the database, not the cookie',
  );
});

test('the role comes from the database for an invited user', () => {
  // A stale cookie would otherwise keep a role the contractor had since
  // changed, which is the same bug as a stale grant but harder to notice.
  const access = source('access.ts');

  assert.match(access, /const role = current\.membership\.role/);
});

test('an unreachable Hub database fails closed, not open', () => {
  // If the membership cannot be checked it cannot be honoured. The safe
  // direction of an outage is that invited users are locked out, never that
  // they arrive with un-narrowed access.
  const access = source('access.ts');
  const branch = access.match(/if \(!hub\.available\)[\s\S]{0,320}?\}/);

  assert.ok(branch);
  assert.match(branch[0], /reason: 'revoked'/, 'an unavailable Hub must deny');
});

test('a session with no membership skips the lookup entirely', () => {
  // A contractor arriving through GoHighLevel has no membership row. Requiring
  // one would lock out the only people who can invite anybody.
  const access = source('access.ts');

  assert.match(access, /if \(membershipId === undefined\)/);
});

// ── What the grants can and cannot do, as `currentAccess` supplies them ─────

test('a revoked resource is hidden the moment the tick changes', () => {
  const before: Record<string, boolean> = {};
  const after = { document: false };

  assert.equal(effectiveCan('client', 'read', 'document', before), true);
  assert.equal(effectiveCan('client', 'read', 'document', after), false);
});

test('a tick still cannot exceed the role, whatever the database says', () => {
  // The grants come from a table a contractor edits. Even if a row said
  // `invoice: true` for a client — by mistake, or by someone editing the
  // database directly — the role decides.
  const hostile = { invoice: true, visibilitySettings: true, project: true };

  assert.equal(effectiveCan('client', 'read', 'invoice', hostile), false);
  assert.equal(effectiveCan('field', 'read', 'invoice', hostile), false);
  assert.equal(effectiveCan('client', 'update', 'visibilitySettings', hostile), false);
});

test('a contractor is never narrowed by grants they do not have', () => {
  assert.equal(effectiveCan('contractor', 'read', 'invoice', {}), true);
  assert.equal(effectiveCan('contractor', 'update', 'project', {}), true);
});

// ── The surfaces that must use it ───────────────────────────────────────────

test('the field and portal shells check access, not just a session', () => {
  // Reading a session only proves someone signed in at some point. For an
  // invited user that is not the same as still being allowed in.
  const app = join(LIB, '..', 'app');

  for (const shell of ['field/layout.tsx', 'portal/layout.tsx']) {
    const text = readFileSync(join(app, shell), 'utf8');
    assert.match(text, /requireAccess\(\)/, `${shell} must call requireAccess`);
  }
});

test('sign-in tries a real account before falling back to a demo identity', () => {
  // Otherwise a demo identity sharing an email would shadow someone's real
  // account, and they would be signed in as somebody else entirely.
  const actions = readFileSync(join(LIB, 'actions.ts'), 'utf8');
  const signIn = actions.match(/export async function signIn\([\s\S]*?\n\}/);

  assert.ok(signIn);
  const realPath = signIn[0].indexOf('authenticate(');
  const demoPath = signIn[0].indexOf('accountForEmail(');
  assert.ok(realPath !== -1, 'sign-in must try real credentials');
  assert.ok(realPath < demoPath, 'real accounts must be tried first');
});

test('the two sign-in paths use different field names', () => {
  // The demo radios and the typed email both submitted `email` at first, so a
  // selected radio shadowed what someone typed and signed them in as a demo
  // identity while they believed they had used their own credentials.
  const form = readFileSync(join(LIB, '..', 'app', 'login-form.tsx'), 'utf8');

  assert.match(form, /name="accountEmail"/);
  assert.match(form, /name="password"/);
});

// ── The ticks reaching a screen ─────────────────────────────────────────────

test('the portal nav is filtered by what the client may read', () => {
  // Without this the tick boxes on the Team screen are a record of intent that
  // nothing enforces — the section stays in the homeowner's navigation and the
  // contractor believes they turned it off.
  const layout = readFileSync(join(LIB, '..', 'app', 'portal', 'layout.tsx'), 'utf8');

  assert.match(layout, /access\.can\('read', item\.resource\)/);
  assert.match(layout, /RESOURCE_FOR_PORTAL_ROUTE/);
});

test('dashboard, timeline and messages are never tickable away', () => {
  // A portal you cannot navigate, and cannot ask a question in, is not a
  // portal. These three have no resource mapped, so no tick removes them.
  const layout = readFileSync(join(LIB, '..', 'app', 'portal', 'layout.tsx'), 'utf8');
  const map = layout.slice(
    layout.indexOf('RESOURCE_FOR_PORTAL_ROUTE'),
    layout.indexOf('};', layout.indexOf('RESOURCE_FOR_PORTAL_ROUTE')),
  );

  for (const always of ["'/portal'", "'/portal/timeline'", "'/portal/messages'"]) {
    assert.equal(map.includes(`${always}:`), false, `${always} must not be tickable`);
  }
});

// ── A missing contractor must never be a 500 ────────────────────────────────

test('every screen that reads the Hub handles an unlinked session', () => {
  // `assertContractor` throws when a session cannot be resolved to a contractor,
  // which is right — the alternative was reading under an auth profile id and
  // silently showing nothing. But a throw reaches the user as a stack trace,
  // and seven of 64 contractor profiles are in that state through no fault of
  // their own.
  //
  // So any page touching a Hub layer has to check first. This finds the ones
  // that forgot.
  const app = join(LIB, '..', 'app');
  const pages: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'page.tsx') pages.push(full);
    }
  };
  walk(app);

  const unguarded = pages.filter((path) => {
    const text = readFileSync(path, 'utf8');
    const readsHub = /getHubTeam|getHubRecords|getHubOperational/.test(text);
    if (!readsHub) return false;

    // Only DIRECT calls into a Hub layer can throw. The same method names
    // reached through `currentDataSource` are safe, because that composes the
    // Hub in only when a contractor resolved — so `db.listMilestones(...)` is
    // fine and `hub.records.listArchived(...)` is not.
    const throwsDirectly =
      /(hub|records|ops|team)\.(records|team|ops)?\.?(listArchived|listTeam|listGrants|listDailyUpdates|listMilestones|listTasks|listIssues)\(/.test(
        text,
      );
    if (!throwsDirectly) return false;

    return !(/contractorId === undefined/.test(text) || /!identity\.resolved/.test(text));
  });

  assert.deepEqual(
    unguarded.map((p) => p.slice(app.length + 1).split(sep).join('/')),
    [],
    'a screen reads the Hub without handling a session that has no contractor',
  );
});
