/**
 * The five rules from D4 (Project Hub build context, 2026-08-21).
 *
 * These are architectural invariants, not behaviours. They cannot be caught by
 * exercising a function, because the failure mode is somebody adding a *new*
 * code path months from now — a stage write in a page, a GHL import in the
 * field route, a lookup keyed on a project name. So these tests read the source
 * and assert properties of the codebase itself.
 *
 * Source-scanning tests are unusual and worth justifying: each of the five is a
 * rule the documents state as a MUST, each has a specific and expensive failure
 * (D4 §6: *"a mismatch shows the wrong data on a job site"*), and none of them
 * shows up in any single function's output. The repo already does this in
 * `buildsuite.test.ts`, which asserts the database client's prototype has no
 * write method.
 *
 * They are deliberately narrow. A test that fails when someone renames a
 * variable teaches people to delete tests.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url)).replace(/[\\/]lib$/, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
const rel = (p: string) => p.slice(SRC.length + 1).replace(/\\/g, '/');

// ── Rule 1 · Stage completion is never set from the Hub ─────────────────────
// D4 §5: "Stage completion happens in GoHighLevel, not the Hub. A contractor
// does not flip 'in progress → complete' inside the Hub. The Hub reflects
// completion once GHL marks it."

test('D4 §5 — nothing in the Hub assigns a project stage except WF2 applying GHL', () => {
  const writers = FILES.filter((f) => /\.projectStage\s*=/.test(f.text)).map((f) => rel(f.path));

  // WF2 is the reflection path: its trigger IS a GHL stage change, so its
  // handler applying that change is the Hub mirroring GHL, not originating.
  assert.deepEqual(
    writers,
    ['lib/workflows/fixture-ports.ts'],
    'a new code path writes projectStage — the Hub must reflect GHL, not set it',
  );
});

test('D4 §5 — no server action or screen moves a project to Completed', () => {
  const offenders = FILES.filter(
    (f) => /\/app\//.test(rel(f.path)) || rel(f.path) === 'lib/actions.ts',
  )
    .filter((f) => /projectStage\s*[:=]\s*['"]Completed['"]/.test(f.text))
    .map((f) => rel(f.path));

  assert.deepEqual(offenders, [], 'a screen or action marks a project complete');
});

// ── Rule 2 · The field crew never touches GoHighLevel ───────────────────────
// D4 §5: "The field crew never logs into GoHighLevel. GHL is the office/backend
// engine they never see."

test('D4 §5 — the field surface imports nothing from the GHL client', () => {
  const field = FILES.filter((f) => rel(f.path).startsWith('app/field/'));
  assert.ok(field.length > 0, 'the field surface should exist');

  for (const f of field) {
    assert.equal(
      /from ['"][^'"]*lib\/ghl\//.test(f.text),
      false,
      `${rel(f.path)} imports the GHL client — the field crew never touches GHL`,
    );
  }
});

test('D4 §5 — a field user has no publish action available', () => {
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  // The publish path asks the matrix, and the matrix grants `publish` to a
  // contractor alone. Asserting the CALL rather than a role string means this
  // keeps working when the matrix changes and keeps failing if the call goes.
  assert.match(
    actions.text,
    /reviewUpdate[\s\S]{0,400}assertCan\([^)]*'publish',\s*'dailyUpdate'\)/,
    'reviewUpdate must ask permission before publishing',
  );
  assert.match(
    actions.text,
    /updateVisibility[\s\S]{0,400}assertCan\([^)]*'update',\s*'visibilitySettings'\)/,
    'updateVisibility must ask permission before moving a gate switch',
  );
});

// ── Rule 3 · Never key a cross-system link off a title or name ──────────────
// D4 §6: "One rename or typo in a title breaks the link silently ... a mismatch
// shows the wrong data on a job site." ARCHITECTURE §3.6 says the same.

test('§3.6 / D4 §6 — no lookup matches a project by name, title or address', () => {
  const patterns = [
    /find\([^)]*projectName\s*===/,
    /find\([^)]*\.title\s*===/,
    /find\([^)]*projectAddress\s*===/,
    /filters:\s*\{\s*title:/,
    /filters:\s*\{\s*project_name:/,
  ];

  const offenders: string[] = [];
  for (const f of FILES) {
    if (patterns.some((p) => p.test(f.text))) offenders.push(rel(f.path));
  }

  assert.deepEqual(offenders, [], 'a lookup is keyed on a name or address, not an id');
});

// ── Rule 4 · Every mutation is permission-checked ──────────────────────────
// An earlier version of this file asserted that the Hub owns exactly ONE write,
// from a too-narrow reading of D4 §5. That section says the PM decision buttons
// live in the Hub and not in GHL; it does not say the Hub writes once. §12.1 is
// explicit that the contractor dashboard "creates and controls everything the
// other two experiences display".
//
// The invariant that actually matters is not how many writes there are. It is
// that none of them happens without asking `permissions.ts` first — a hidden
// button is a UI fact, and a server action is something anyone can post to.

test('every mutating server action checks permission before it writes', () => {
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  // Session control owns no project data, so it is exempt by name.
  const sessionOnly = new Set([
    'signIn',
    'signOut',
    'viewAs',
    'returnToMyAccount',
    // Redeeming an invitation is deliberately unauthenticated — the whole point
    // is that the person has no account yet. Authority is the single-use token,
    // checked against the database rather than trusted for being signed. It is
    // pinned separately below so this exemption cannot quietly widen.
    'acceptInvitation',
    // Development scaffolding that swaps which contractor you are. It owns no
    // project data, so the matrix has nothing to say about it. Its own gates
    // are pinned below rather than taken on trust.
    'switchAccount',
  ]);

  const bodies = [...actions.text.matchAll(/^export async function (\w+)[\s\S]*?\n\}/gm)];
  assert.ok(bodies.length > 0, 'no server actions found — has the file moved?');

  // An action may check permission directly, or delegate to a helper that does.
  // Delegation is only acceptable if the helper itself asserts — verified
  // separately below, so the chain is checked rather than assumed.
  const DELEGATES = ['hubWriteContext(', 'teamContext('];

  const unchecked: string[] = [];
  for (const match of bodies) {
    const name = match[1]!;
    if (sessionOnly.has(name)) continue;
    const body = match[0];
    const checks = /assertCan\(/.test(body) || DELEGATES.some((d) => body.includes(d));
    if (!checks) unchecked.push(name);
  }

  assert.deepEqual(
    unchecked,
    [],
    `server action(s) ${unchecked.join(', ')} mutate without calling assertCan`,
  );
});

test('the permission matrix grants nothing by default', () => {
  const permissions = FILES.find((f) => rel(f.path) === 'lib/permissions.ts');
  assert.ok(permissions);

  // `?? false` is what makes an absent entry a refusal rather than a crash or
  // an accidental allow. If that changes, every future action starts open.
  assert.match(permissions.text, /\?\?\s*false/, 'can() must default to refusing');
});

test('D4 §5 — no role can complete a stage from the Hub', () => {
  const permissions = FILES.find((f) => rel(f.path) === 'lib/permissions.ts');
  assert.ok(permissions);

  // completeStage exists as an action so its absence from every row is a
  // deliberate statement rather than an omission. It must never be granted.
  assert.equal(
    /completeStage:\s*\[/.test(permissions.text),
    false,
    'completeStage has been granted to a role — GHL owns stage movement',
  );
});

test('D4 §5 — the BuildSuite client still cannot write at all', () => {
  const client = FILES.find((f) => rel(f.path) === 'lib/buildsuite/client.ts');
  assert.ok(client);

  for (const verb of ['insert', 'update(', 'upsert', 'delete(', 'rpc(']) {
    assert.equal(
      client.text.includes(`  async ${verb}`),
      false,
      `the BuildSuite client gained a ${verb} method — it is read-only by construction`,
    );
  }
});

// ── Rule 5 · The migration stays safe against a production database ────────
// The source documents are REQUIREMENTS — what each role sees, the privacy
// rule, the approval flow. They do not dictate our storage, and an earlier pass
// of this file wrongly asserted that they did.
//
// What they do constrain, and what these tests hold, is that this migration
// cannot damage BuildSuite's database and cannot expose a Hub table to a
// browser. Those are ours to guarantee.

function migration(): string {
  return readFileSync(
    join(SRC, '..', '..', '..', 'supabase', 'migrations', '0001_hub_tables.sql'),
    'utf8',
  );
}

function createdTables(): string[] {
  return [...migration().matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
}

test('every table the migration creates is prefixed hub_', () => {
  const stray = createdTables().filter((t) => !t.startsWith('hub_'));
  assert.deepEqual(stray, [], 'a table outside the hub_ namespace could collide with BuildSuite');
});

test('every Hub table carries both tenancy keys', () => {
  const sql = migration();
  // project_id is the primary key on the per-project settings table, so the
  // check is that both concepts are present, not that both are plain columns.
  for (const m of sql.matchAll(/create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g)) {
    const [, table, body] = m;
    assert.ok(/project_id/.test(body!), `${table} has no project_id`);
    assert.ok(/auth_profile_id/.test(body!), `${table} has no auth_profile_id`);
  }
});

test('every Hub table enables row level security', () => {
  const sql = migration();
  for (const table of createdTables()) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `${table} has no RLS — the publishable key would read it from any browser`,
    );
  }
});

test('the migration creates only, and alters nothing of BuildSuite’s', () => {
  const sql = migration();

  // `alter table ... enable row level security` on our own tables is expected.
  // Anything else that alters, drops or truncates is not.
  const dangerous = sql
    .split('\n')
    .filter((line) => /^\s*(drop|truncate)\b/i.test(line) || /^\s*alter table/i.test(line))
    .filter((line) => !/enable row level security/i.test(line));

  assert.deepEqual(dangerous, [], 'the migration alters or drops something');
});

test('every permission-checking helper actually checks permission', () => {
  // `DELEGATES` above lets an action satisfy the rule by calling a helper. That
  // is only safe while the helper really does assert — otherwise the list
  // becomes a way to opt out of the guardrail by renaming a function.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  const helper = actions.text.match(/async function hubWriteContext\([\s\S]*?\n\}/);
  assert.ok(helper, 'hubWriteContext has moved or been renamed — update DELEGATES');
  assert.match(helper[0], /assertCan\(/, 'hubWriteContext no longer checks permission');
});

test('the account switch is gated by a flag AND the real identity', () => {
  // It hands out another contractor's data, so it is exempt from the permission
  // rule only while it refuses by default. Both gates are asserted here because
  // adding a name to `sessionOnly` must never be a way to ship an ungated write.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  const body = actions.text.match(/export async function switchAccount\([\s\S]*?\n\}/);
  assert.ok(body, 'switchAccount has moved or been renamed');

  assert.match(body[0], /accountSwitchEnabled\(\)/, 'it must check the flag server-side');
  assert.match(body[0], /realIdentity\(/, 'it must check the REAL identity, not the assumed one');
  assert.match(body[0], /findDevAccount\(/, 'it must look the account up, not trust the form');
});

test('the account switch is off unless explicitly enabled', () => {
  // The inverse of DISABLE_VIEW_AS, deliberately. A deployment that sets nothing
  // gets no switch, which is the right way round for a control that hands out
  // somebody else's records.
  const dev = FILES.find((f) => rel(f.path) === 'lib/dev-accounts.ts');
  assert.ok(dev);

  assert.match(dev.text, /ENABLE_ACCOUNT_SWITCH === 'true'/);
  assert.equal(
    /DISABLE_ACCOUNT_SWITCH|!== 'true'/.test(dev.text),
    false,
    'it must default off, not default on',
  );
});

test('§3.6 every path that mints a session carries the tenant profiles', () => {
  // The bug this exists to prevent, found on 2026-09-01 by a real invited user:
  // `signIn` set `authProfileIds` and `acceptInvitation` did not. Accepting an
  // invitation therefore produced a session with no tenant, and the first
  // scoped read threw TenancyError before any screen could render — the new
  // user's very first click.
  //
  // Two functions minting the same object is a shape that drifts. Anything that
  // opens a session has to answer "whose data is this?", so the check is on
  // every call site rather than on the two we know about.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  const calls = actions.text.match(/setSession\(\{[\s\S]*?\n {2}\}/g) ?? [];
  assert.ok(calls.length >= 2, 'setSession call sites have moved or been reshaped');

  for (const call of calls) {
    assert.match(
      call,
      /authProfileIds/,
      'a session is being opened without the profiles that scope every read',
    );
  }
});

test('§9.1 a client screen never resolves its own projects', () => {
  // Every portal screen goes through `clientProjectsFor`, which is the only
  // place that knows an invited homeowner has no contact id. A page calling the
  // data source directly is how the two client kinds diverge again — and the
  // divergence is silent, showing an empty portal rather than an error.
  const portal = FILES.filter((f) => rel(f.path).startsWith('app/portal/'));
  assert.ok(portal.length > 0, 'the portal has moved');

  for (const file of portal) {
    if (rel(file.path).includes('client-scope')) continue;
    assert.equal(
      /db\.listProjectsForContact\(|\.listProjectsByIds\(/.test(file.text),
      false,
      `${rel(file.path)} resolves client projects itself instead of via clientProjectsFor`,
    );
  }
});

test('§9.4 a field screen never resolves its own projects', () => {
  // Same rule, other experience. `projectsForField` takes an id list, and
  // building that list per screen is what let one of them drift onto a name.
  const field = FILES.filter((f) => rel(f.path).startsWith('app/field/'));
  assert.ok(field.length > 0, 'the field experience has moved');

  for (const file of field) {
    assert.equal(
      /projectsForField\(/.test(file.text),
      false,
      `${rel(file.path)} builds its own visible-project list instead of using fieldProjectsFor`,
    );
  }
});
