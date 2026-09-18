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
import { dirname, extname, join, relative, resolve } from 'node:path';
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

/**
 * Source with its comments removed.
 *
 * For guardrails that assert a call is or is NOT made. A comment explaining a
 * past bug names the thing it is explaining, so a plain text search finds it in
 * the prose and reports a defect that was fixed — which is the failure mode
 * that gets guardrails deleted.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

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
  //
  // `requestSignIn` joins them and is the clearest case of the category: it runs
  // BEFORE anyone is signed in, so there is no session for `assertCan` to check,
  // and it writes nothing at all — it locates a record and sends an email. The
  // invariant here is "no write without a permission check", and an action that
  // performs no write cannot breach it. Its own protections are different in
  // kind and live with it: an attempt limit, and a response that is identical
  // whether or not an account matched (`sign-in-request.ts`).

  const sessionOnly = new Set([
    // The ONE sign-in (2026-09-15), which includes the homeowner's project-code
    // path. Unlike `requestSignIn` it DOES write — a homeowner's first sign-in
    // opens their membership — so the exemption is not "it writes nothing" but
    // "it runs before there is a session, so there is no role for `assertCan`
    // to check". What authorises that write is the signed contract itself,
    // matched inside BuildSuite. Pinned below, so this line cannot quietly widen.
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
    'requestSignIn',
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

test('the sign-in delegates its whole decision, and widens nothing', () => {
  // `signIn` is exempt from the permission rule because it runs before a
  // session exists. That exemption is only safe while the action stays pure
  // wiring: the routing in `auth/unified-sign-in.ts` and the homeowner check in
  // `auth/client-credentials.ts`, both tested without a database, and nothing
  // decided inline where it cannot be.
  //
  // It was `signInWithCode`, the homeowner's own action, until sign-in became
  // one route on 2026-09-15. The same four ways this goes wrong apply to the
  // merged action, and they are checked here rather than trusted.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  const body = actions.text.match(/export async function signIn\([\s\S]*?\n\}/);
  assert.ok(body, 'signIn has moved or been renamed');
  assert.equal(
    /export async function signInWithCode\(/.test(actions.text),
    false,
    'a second sign-in action is a second door with its own rules — keep one',
  );

  assert.match(body[0], /unifiedSignIn\(/, 'who the person is must be decided by the tested module');
  assert.match(
    body[0],
    /signInWithProjectCode\(/,
    'the homeowner decision must come from the policy module, not from a comparison written here',
  );

  // An unavailable BuildSuite must never become an unauthenticated sign-in.
  // There is deliberately no fixture reader on this path at all.
  assert.match(
    body[0],
    /buildsuite\.available && hub\.available\s*\?\s*signInWithProjectCode\(/,
    'the homeowner check must run only when both databases are there',
  );

  // A `contactId` sends the portal down `listProjectsForContact`, which returns
  // EVERY project that contact holds — including ones whose code this visitor
  // has never proved. That is precisely the widening the retired emailed-link
  // door had. The only `contactId` allowed in this action is the demo
  // identity's own, on the development-only branch.
  const clientBranch = body[0].match(/outcome\.result === 'client'[\s\S]*?redirect\(/);
  assert.ok(clientBranch, 'the homeowner branch has moved');
  assert.equal(
    /contactId:/.test(clientBranch[0]),
    false,
    'a code sign-in must scope to the membership, never to a contact',
  );
});

test('an appointment email goes only to addresses the server looked up, after the save', () => {
  // John, 2026-09-17: tagging the homeowner or a crew member emails them and
  // the contractor. The form posts a KEY; if it could post an address, the
  // Schedule screen would be a way to send mail as the contractor to anyone.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);
  const body = (name: string) => {
    const m = actions.text.match(new RegExp(`(?:export )?async function ${name}\\([\\s\\S]*?\\n\\}\\r?\\n`));
    assert.ok(m, `${name} has moved or been renamed`);
    return withoutComments(m[0]);
  };

  const sender = body('emailAppointment');
  assert.equal(/formData/.test(sender), false, 'the sender must not read the form at all');
  // The homeowner is given the code on their contract, never the award code.
  assert.match(sender, /r\.audience === 'homeowner' \? clientCode\(project\) : contractorCode\(project\)/);

  for (const [name, save] of [['createScheduleItem', 'schedule.create('], ['updateScheduleItem', 'schedule.update(']] as const) {
    const b = body(name);
    assert.equal(/formData\.get\('(?:email|assigneeEmail|to|recipient)'\)/.test(b), false, `${name} reads an address from the form`);
    assert.match(b, /resolveAssignee\(/, `${name} must resolve the posted key against what was offered`);
    assert.ok(b.includes(save) && b.indexOf(save) < b.indexOf('emailAppointment('), `${name} must save before it emails`);
  }
});

test('the schedule offers people to tag, and the portal never shows a crew address', () => {
  const page = FILES.find((f) => rel(f.path) === 'app/dashboard/projects/[id]/schedule/page.tsx');
  const gates = FILES.find((f) => rel(f.path) === 'lib/portal-gates.ts');
  assert.ok(page && gates);
  assert.equal(/name="trade"/.test(page.text), false, 'trade or crew is a dropdown of people now, not free text');
  assert.match(page.text, /<AssigneeSelect[^>]*current=""/, 'the new-appointment form uses the dropdown');
  assert.match(page.text, /<AssigneeSelect[^>]*current=\{item\.trade\}/, 'the edit form uses the dropdown');
  assert.match(withoutComments(gates.text), /trade: portalSafeTrade\(item\.trade\)/);
});

test('only the contractor hands out work, and only to crew on the project', () => {
  // John, 2026-09-17: contractors assign tasks to the crew. `update` on a task
  // is shared with the field (they start and finish their own work), so an
  // action that ASSIGNS must ask for `create`, which is the contractor's alone —
  // otherwise a crew member could post a reassignment.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);
  const body = (name: string) => {
    const m = actions.text.match(new RegExp(`(?:export )?async function ${name}\\([\\s\\S]*?\\n\\}\\r?\\n`));
    assert.ok(m, `${name} has moved or been renamed`);
    return withoutComments(m[0]);
  };

  for (const name of ['createProjectTask', 'updateProjectTask']) {
    const b = body(name);
    assert.match(b, /assertCan\(session\.role, 'create', 'task'\)/, `${name} must require the contractor's permission`);
    assert.match(b, /taskPeople\(scope, projectId\)/, `${name} must read the project through the contractor's scope`);
    assert.match(b, /resolveTaskAssignee\(options,/, `${name} must resolve the assignee against the project's crew`);
  }
  assert.match(body('updateProjectTask'), /assignmentChange\(existing\.assignedTo,/, 'the stored assignee decides whether it is a new ding');

  // "Got it" must clear the badge on the task the crew member actually sees.
  const seen = body('markTaskSeen');
  assert.match(seen, /currentDataSource\(scope\)\)\.listTasks\(scope\)/, 'read from the same source the Tasks screen reads');
  assert.match(seen, /ownsTask\(session, task\)/);
});

test('the Tasks section is under every project', () => {
  const nav = FILES.find((f) => rel(f.path) === 'lib/project-nav.ts');
  assert.ok(nav);
  assert.match(nav.text, /\{ seg: 'tasks', label: 'Tasks' \}/);
});

test('a crew member acts only on their own task, and files it under that task’s project', () => {
  // John, 2026-09-17: the crew opens a task, sets its status, and sends an
  // update with photos. Each action must re-read the task through the caller's
  // scope, and must file a photo or update under the STORED task's project — a
  // project id from the form would let a crew member write into any job.
  const mod = FILES.find((f) => rel(f.path) === 'lib/actions/field-tasks.ts');
  assert.ok(mod, 'lib/actions/field-tasks.ts has moved');
  const text = withoutComments(mod.text);
  const exported = [...text.matchAll(/export async function (\w+)\([\s\S]*?\n\}\r?\n/g)];
  assert.ok(exported.length >= 4, 'the crew task actions have moved');

  for (const m of exported) {
    assert.match(m[0], /assertCan\(/, `${m[1]} writes without asking permission`);
  }
  const body = (name: string) => exported.find((m) => m[1] === name)?.[0] ?? '';
  for (const name of ['setFieldTaskStatus', 'postTaskUpdate', 'uploadTaskPhoto']) {
    assert.match(body(name), /myTask\(taskId\)/, `${name} must start from the caller's own task`);
    assert.equal(/formData\.get\('projectId'\)/.test(body(name)), false, `${name} must not take the project from the form`);
  }
  assert.match(body('postTaskUpdate'), /projectId: task\.projectId/);
  assert.match(body('uploadTaskPhoto'), /projectId: context\.task\.projectId/);
  // The one that does take a project from the form checks it against theirs.
  assert.match(body('uploadFieldPhoto'), /fieldProjectsFor\(access, projects, tasks\)\.some\(/);
  // And the task itself: assigned to this person, on one of their projects.
  assert.match(text, /tasksForField\(tasks, mine, access\.session\.membershipId \?\? ''\)/);
  assert.match(text, /ownsTask\(access\.session, task\)/);
});

test('a photo from a phone can be uploaded: shrunk first, and under the raised limit', () => {
  // Every upload was a server action at Next's 1 MB default, and a phone photo
  // is 2-10 MB, so crew photos could not be saved. The field screens now go
  // through <PhotoUploader>, which shrinks before sending; a bare file input
  // would bring the full-size photo back.
  const offenders = FILES.filter((f) => rel(f.path).startsWith('app/field/') && /type="file"/.test(f.text)).map((f) => rel(f.path));
  assert.deepEqual(offenders, [], 'use <PhotoUploader> on the field screens');

  const uploader = FILES.find((f) => rel(f.path) === 'components/photo-uploader.tsx');
  assert.ok(uploader);
  assert.match(uploader.text, /fitWithin\(bitmap\.width, bitmap\.height, PHOTO_MAX_EDGE\)/);
  assert.match(uploader.text, /canvas\.toBlob\(resolve, 'image\/jpeg'/);

  const config = readFileSync(join(SRC, '..', 'next.config.mjs'), 'utf8');
  assert.match(config, /bodySizeLimit: '4mb'/, 'the server-action body limit is what lets a shrunk photo through');
});

test('an assigned task opens, and only for the person it is assigned to', () => {
  const page = FILES.find((f) => rel(f.path) === 'app/field/tasks/[id]/page.tsx');
  const list = FILES.find((f) => rel(f.path) === 'app/field/tasks/page.tsx');
  assert.ok(page && list);
  assert.match(page.text, /tasksForField\(tasks, mine, session\?\.membershipId \?\? ''\)\.find\(/);
  assert.match(page.text, /if \(task === undefined\) notFound\(\)/);
  assert.match(list.text, /href=\{`\/field\/tasks\/\$\{task\.id\}`\}/, 'the Tasks list must link to each task');
});

test('a homeowner is served a file only through the portal’s own gates', () => {
  // A homeowner holds no tenant scope, so `?path=` can never answer them: a
  // released photo showed a grey placeholder and a released document had no
  // link at all. `?id=&kind=` serves the ROW — and for a client it must be read
  // through `photosFor` / `documentsFor`, which apply the portal switch, the
  // section switch and `client_visible`. Anything else would serve an
  // unreleased photo to the person it was withheld from.
  const route = FILES.find((f) => rel(f.path) === 'app/api/files/route.ts');
  assert.ok(route, 'the file route has moved');
  const text = withoutComments(route.text);
  const clientBranch = text.match(/session\.role === 'client'[\s\S]*?return NextResponse\.json\(\{ error: 'not found' \}, \{ status: 404 \}\);/);
  assert.ok(clientBranch, 'the homeowner branch has moved');
  assert.match(clientBranch[0], /photosFor\(project\)/);
  assert.match(clientBranch[0], /documentsFor\(project\)/);
  assert.equal(/actionTenantScope/.test(clientBranch[0]), false, 'a homeowner has no tenant scope to assert');

  // The portal links files by id, never by storage path — a path names a file
  // and carries no release flag.
  const offenders = FILES.filter((f) => rel(f.path).startsWith('app/portal/') && /api\/files\?path=/.test(f.text)).map((f) => rel(f.path));
  assert.deepEqual(offenders, [], 'portal screens must link files by id');
});

test('every photo on a project is one list, whoever added it', () => {
  // A task photo, an update photo, a photo the contractor added: all are
  // hub_photos rows on the project, and the Photos screens list the project's
  // rows without filtering by who uploaded them.
  const page = FILES.find((f) => rel(f.path) === 'app/dashboard/projects/[id]/photos/page.tsx');
  const manager = FILES.find((f) => rel(f.path) === 'components/media-manager.tsx');
  assert.ok(page && manager);
  assert.match(page.text, /listForProject\(scope, 'photo', id\)/);
  const filtered = /uploaded_?[Bb]y\s*===|uploadedBy\s*===/.test(withoutComments(page.text) + withoutComments(manager.text));
  assert.equal(filtered, false, 'a Photos list must not be narrowed to one uploader');
  // And it shows the photograph, not only a link to it.
  assert.match(manager.text, /<img/);
});

test('anything that acts on another sub-account uses that sub-account’s token', () => {
  // A GoHighLevel Private Integration token only opens its own sub-account:
  // measured 17 Sep, the AFC token gets 401 "This location is not accessible
  // from this token!" on Alliance Pro Services, and the reverse. So a caller
  // that swaps in the session's location must swap the token with it
  // (GHL_LOCATION_TOKENS), or every other contractor's call is a guaranteed
  // 401 — invoices hit exactly that, and email would have next.
  const callers = ['lib/ghl/email.ts', 'lib/ghl/invoices.ts', 'lib/invoicing/rail.ts'];
  for (const path of callers) {
    const file = FILES.find((f) => rel(f.path) === path);
    assert.ok(file, `${path} has moved`);
    const text = withoutComments(file.text);
    assert.match(text, /withLocationToken\(/, `${path} must take the location's own token`);
    assert.equal(
      /[^a-zA-Z]withLocation\(/.test(text),
      false,
      `${path} still swaps the location while keeping the default token`,
    );
  }
});

test('nothing that runs in the browser imports the demo identities as values', () => {
  // `demo-accounts.ts` holds real BuildSuite profile ids. A browser-side file —
  // or a module one imports, like `session-mismatch.ts` for the error page —
  // may take its TYPES (erased at build) but never a value, or the identities
  // ship to every visitor.
  const DEMO_MODULE = /from '(?:@\/lib\/demo-accounts|@\/lib\/session|\.\/demo-accounts(?:\.ts)?|\.\/session(?:\.ts)?)'/;
  const offenders: string[] = [];
  for (const file of FILES) {
    const path = rel(file.path);
    const browserSide = /^\s*['"]use client['"]/.test(file.text) || path === 'lib/session-mismatch.ts';
    if (!browserSide) continue;
    for (const line of file.text.split('\n')) {
      if (DEMO_MODULE.test(line) && !/^\s*import type /.test(line)) offenders.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], 'use `import type` — values from these modules must stay on the server');
});

test('every error page says who the screen belongs to', () => {
  // The error page checks the browser's current role before blaming the
  // database (2026-09-17). An error page that did not say whose screen it is
  // could not tell a crew sign-in in another tab from a refused write.
  const pages = FILES.filter((f) => /(^|\/)error\.tsx$/.test(rel(f.path)) && f.text.includes('<FriendlyError'));
  assert.ok(pages.length >= 4, `expected the four error pages, found ${pages.length}`);
  const missing = pages.filter((f) => !/allowedRoles=\{/.test(f.text)).map((f) => rel(f.path));
  assert.deepEqual(missing, []);

  const contractorOnly = pages.filter((f) => rel(f.path).startsWith('app/dashboard/'));
  for (const f of contractorOnly) {
    assert.match(f.text, /const ALLOWED = \['contractor'\] as const/, `${rel(f.path)} belongs to the contractor alone`);
  }
});

test('demo sign-in is shut unless ENABLE_DEMO_SIGNIN is exactly "true"', () => {
  // Until 2026-09-15 the public sign-in page listed demo identities as radio
  // buttons. Each carries a REAL BuildSuite profile and none has a password, so
  // on a reachable deployment anyone could open real client records. The flag
  // is the only thing between that and the internet; these pin it shut.
  const demo = FILES.find((f) => rel(f.path) === 'lib/demo-accounts.ts');
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  const page = FILES.find((f) => rel(f.path) === 'app/page.tsx');
  const form = FILES.find((f) => rel(f.path) === 'app/login-form.tsx');
  assert.ok(demo && actions && page && form);

  const flag = demo.text.match(/export function demoSignInEnabled\(\)[\s\S]*?\n\}/);
  assert.ok(flag, 'demoSignInEnabled has moved or been renamed');
  assert.match(
    flag[0],
    /process\.env\.ENABLE_DEMO_SIGNIN === 'true'/,
    'a strict comparison: "1", "yes" or a typo must leave it shut',
  );

  const signIn = actions.text.match(/export async function signIn\([\s\S]*?\n\}/);
  assert.ok(signIn);
  assert.match(
    signIn[0],
    /demo: demoSignInEnabled\(\) \? accountForEmail : null/,
    'the action must pass no demo lookup unless the flag is on',
  );

  // The page decides what the browser receives: nothing, unless the flag is on.
  assert.match(page.text, /demoSignInEnabled\(\)\s*\?\s*DEMO_ACCOUNTS/, 'the page must gate the list on the flag');
  // And the client component must never hold the identities itself — anything
  // it imports ships to every visitor's browser.
  assert.equal(
    /DEMO_ACCOUNTS|demo-accounts|@\/lib\/session/.test(withoutComments(form.text)),
    false,
    'the sign-in form must not import the demo identities',
  );
});

test('the homeowner code door is the only unauthenticated path that opens an account', () => {
  // `provisionClientFromSignedProject` creates a membership with no session, no
  // scope and no invitation behind it. Exactly one caller may do that, and it
  // is the one whose input BuildSuite has already verified against a signed
  // contract. Anywhere else, it is an account-creation primitive with nothing
  // in front of it.
  const callers = FILES.filter((f) => {
    const path = rel(f.path);
    if (path.startsWith('lib/hub-db/team.') || path.endsWith('.test.ts')) return false;
    return /provisionClientFromSignedProject\(/.test(f.text);
  }).map((f) => rel(f.path));

  assert.deepEqual(callers, ['lib/auth/client-credentials.ts']);
});

test('a homeowner is never invited, and never inherits a BuildSuite profile', () => {
  // Two doors for one person, with different rules, is how the stale one wins.
  // Chris removed the invited-client door on 2026-09-10; access now follows the
  // signed contract. `INVITABLE_ROLES` is the single place that decides it, and
  // `invite()` validates against it.
  const team = FILES.find((f) => rel(f.path) === 'lib/hub-db/team.ts');
  assert.ok(team);

  const roles = team.text.match(/export const INVITABLE_ROLES = \[([^\]]*)\]/);
  assert.ok(roles, 'INVITABLE_ROLES has moved or been reshaped');
  assert.equal(
    /'client'/.test(roles[1]!),
    false,
    'a homeowner must not be invitable — their account follows the signed contract',
  );

  // And the profile list they are created with. An inherited profile would open
  // every one of the contractor's BuildSuite projects to them.
  //
  // Sliced by index rather than matched with one regex: the method's PARAMETER
  // object closes with the same `\n  }` the method does, so a lazy match
  // stopped at the signature and asserted against six lines that could never
  // contain either thing. Caught by watching this pass on a body it had not
  // read — the failure mode a source-scanning test is most prone to.
  const from = team.text.indexOf('async provisionClientFromSignedProject(');
  assert.notEqual(from, -1, 'provisionClientFromSignedProject has moved or been renamed');
  const rest = team.text.slice(from + 1);
  const next = rest.search(/\n {2}(async |\/\*\*)/);
  const provision = [rest.slice(0, next === -1 ? undefined : next)];
  assert.match(
    provision[0],
    /auth_profile_ids: \[\]/,
    'a homeowner must be created with no BuildSuite profiles at all',
  );
  assert.equal(
    /password_hash:/.test(provision[0]),
    false,
    'the project code must never be written to password_hash',
  );
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

test('§9.1 every portal screen resolves its project through ONE function', () => {
  // A homeowner arrives two ways — already a GoHighLevel contact, or through a
  // membership with no contact id — and since 2026-09-10 the code sign-in mints
  // NO contact id at all, so the membership path is the normal one.
  //
  // `currentPortalProject` resolved only the contact kind: it was guarded by
  // `session.contactId !== undefined` and everyone else fell past it to
  // `{ project: null }`. Eleven of the fourteen portal screens resolve there, so
  // a homeowner signed in successfully and found "No project" on Documents,
  // Photos, Schedule, Budget, Timeline, Updates, Issues, Messages, Designs,
  // Change Orders and Completion. Silent, and it reads as "nothing shared yet"
  // rather than as a fault.
  //
  // `clientProjectsFor` is the one place that knows about both kinds. This
  // pins `currentPortalProject` to it so the two cannot drift apart again.
  const portalData = FILES.find((f) => rel(f.path) === 'lib/portal-data.ts');
  assert.ok(portalData);

  const from = portalData.text.indexOf('export async function currentPortalProject');
  assert.notEqual(from, -1, 'currentPortalProject has moved or been renamed');
  const rest = portalData.text.slice(from);
  // Up to the next top-level export, so the contractor branch below it is
  // not mistaken for part of this one.
  const nextExport = rest.indexOf('\nexport ');
  const body = nextExport === -1 ? rest : rest.slice(0, nextExport);

  // The CLIENT branch specifically. A contractor previewing resolves from the
  // preview id, which is a different question and stays as it is.
  // Bounded at the CONTRACTOR branch rather than by a character count. A fixed
  // slice was the first attempt and it failed on a long comment — a guardrail
  // whose reach depends on how much prose sits above the code is one that
  // starts passing when somebody edits a comment.
  const clientStart = body.indexOf("session?.role === 'client'");
  const contractorStart = body.indexOf("session?.role === 'contractor'");
  assert.notEqual(clientStart, -1, 'the client branch has moved');
  const clientBranch = body.slice(
    clientStart,
    contractorStart > clientStart ? contractorStart : undefined,
  );

  // CODE ONLY. The comment inside that branch quotes the old call by name to
  // explain what went wrong, and the first version of this test matched its own
  // explanation and failed on correct code. A guardrail that reads prose will
  // eventually be satisfied — or defeated — by prose.
  const code = withoutComments(clientBranch);

  assert.match(
    code,
    /clientProjectsFor\(/,
    'the client branch must resolve through clientProjectsFor',
  );
  assert.equal(
    /listProjectsForContact\(/.test(code),
    false,
    'resolving a homeowner by contact id alone strands everyone who has none',
  );
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

    // §3.6, the specific shape it took twice: filtering on `superintendent`,
    // once against a session name and once against a hardcoded 'Tony Alvarez'.
    // The first check above would not have caught either, because neither went
    // through `projectsForField` — they rolled their own `.filter`.
    assert.equal(
      /\.superintendent\b/.test(file.text),
      false,
      `${rel(file.path)} filters on a name field; access is keyed on ids (§3.6)`,
    );
  }
});


test('§3.6 only scope.ts builds a tenant scope from a session', () => {
  // Six call sites assembled this by hand and every one broke identically for
  // an invited member: they read `session.ghlLocationId`, which only a
  // GoHighLevel sign-in sets, so the location was blank and assertScope
  // refused. Fixing the page helper alone left every server action still
  // throwing — the screens worked and submitting an update did not.
  //
  // The rule is not "remember the location". It is that a scope comes from one
  // function, so there is one place for the next fact a scope needs.
  for (const file of FILES) {
    const path = rel(file.path);
    // The one place a scope is built from a session. It lives in
    // `tenant-scope.ts` so it can be tested without a Next runtime;
    // `scope.ts` re-exports it and adds the redirect/throw wrappers.
    if (path === 'lib/scope.ts' || path === 'lib/tenant-scope.ts') continue;

    assert.equal(
      /locationId:\s*session\./.test(file.text),
      false,
      `${path} builds a scope by hand; use requireTenantScope or actionTenantScope`,
    );
    assert.equal(
      /ghlLocationId\s*\?\?\s*''/.test(file.text),
      false,
      `${path} defaults a blank location; a blank tenant filter is no filter`,
    );
  }
});

test('§9.1 the public signed-contract URL never reaches a client surface', () => {
  // Sing, 2026-09-09: the signed PDF link is PUBLIC and unauthenticated —
  // anyone holding it opens the client's contract, prices and address included.
  //
  // It is fine behind the contractor's login and must go no further. The two
  // ways it escapes are a portal screen rendering it, and an email carrying it,
  // so both are checked. Chris has not ruled on wider sharing; until he does,
  // the conservative reading is the one in force.
  const leaky = FILES.filter((f) => {
    const path = rel(f.path);
    const clientFacing =
      path.startsWith('app/portal/') || path.startsWith('lib/email/') || path.includes('invitation');
    return clientFacing && /signedPdfUrl|signed_pdf_url/.test(f.text);
  }).map((f) => rel(f.path));

  assert.deepEqual(leaky, [], 'a public contract link reached a client-facing surface');
});

test('every signed-contract link carries rel="noreferrer"', () => {
  // Otherwise the storage host is told which of our pages the contractor opened
  // it from, which leaks the tenant and the screen alongside the document.
  for (const file of FILES) {
    if (!/href=\{[^}]*signedPdfUrl/.test(file.text)) continue;
    const anchors = file.text.match(/<a\b[\s\S]{0,400}?signedPdfUrl[\s\S]{0,400}?>/g) ?? [];
    for (const anchor of anchors) {
      assert.match(anchor, /rel="noreferrer"/, `${rel(file.path)} links it without noreferrer`);
    }
  }
});

test('a screen that reads the Hub handles an account with no contractor', () => {
  // `assertContractor` throws when a session does not resolve to a contractor
  // record, which is correct — everything the Hub stores is filed under one.
  // But a TenancyError on screen tells the person nothing they can act on, and
  // NINE of the sixty-eight accounts on this location do not resolve.
  //
  // Found on 2026-09-10 by opening Schedule as chris@allianceforcontractors.com
  // and getting a 500. Every Hub-backed project screen must say so instead.
  const offenders: string[] = [];

  for (const file of FILES) {
    const path = rel(file.path);
    if (!path.startsWith('app/dashboard/projects/')) continue;
    // Only the repositories whose READ methods call `assertContractor`. This
    // was `getHub[A-Z]\w*` and flagged two screens that are fine: `records`
    // reads overlays through `assertScope`, which an unlinked account passes.
    // A guardrail that fires on working code gets exemptions added to it until
    // it means nothing.
    if (!/getHub(Schedule|Media|Selections|Operational)\(\)/.test(file.text)) continue;
    // The GUARD, not the import. Matching `NotLinkedToContractor` anywhere
    // passed on a file that only imported it — verified by deleting the guard
    // and watching this test stay green.
    if (/scope\.contractorId === undefined/.test(file.text)) continue;
    offenders.push(path);
  }

  assert.deepEqual(
    offenders,
    [],
    'a Hub-backed screen throws TenancyError instead of explaining the account is unlinked',
  );
});

test('no form submits through a button that stays live during the round trip', () => {
  // A server action takes a round trip. A plain `<button type="submit">` stays
  // clickable throughout, so a second click fires the action again.
  //
  // Mostly that is a duplicate row. Twice it is worse: "Create in GoHighLevel"
  // would make a SECOND real invoice a homeowner could be asked to pay, and
  // "Approve change order" would record a client's answer twice. The unique
  // index behind the first is a guard that has to win a race; a button that
  // cannot be clicked twice is a click that never happens.
  const offenders: string[] = [];

  for (const file of FILES) {
    const path = rel(file.path);
    if (!path.startsWith('app/') && !path.startsWith('components/')) continue;
    // The component that implements the behaviour, and the two that had
    // already solved it their own way with `useFormStatus` before this existed.
    // Exempt because they DO disable while pending, not because they are old.
    // The two sign-in forms were on this list too; since 2026-09-15 there is
    // one, and it uses <SubmitButton>.
    const handlesItsOwn = [
      'components/submit-button.tsx',
      'components/account-switcher.tsx',
      'components/view-switcher.tsx',
    ];
    if (handlesItsOwn.includes(path)) continue;
    if (/type="submit"/.test(file.text)) offenders.push(path);
  }

  assert.deepEqual(
    offenders,
    [],
    'use <SubmitButton>, which disables itself while the form is in flight',
  );
});

test('§1.4 portal navigation stays on the project being shown', () => {
  // Chris, huddle 2026-09-10: "keep the preview mode seamless". Every portal
  // page picks its project from `?preview=` or `?project=`, and the nav dropped
  // both — so the portal fell back to the FIRST project on the next click. A
  // contractor previewing job B was shown job A's client view; a homeowner with
  // two jobs was put back on the first. `portalHref` carries them; this checks
  // every nav link in both components still goes through it.
  const nav = FILES.find((f) => rel(f.path) === 'components/sidebar-nav.tsx');
  assert.ok(nav, 'sidebar-nav.tsx has moved');

  const code = withoutComments(nav.text);
  const bare = code.match(/href=\{item\.href\}/g) ?? [];
  assert.deepEqual(bare, [], 'a nav link uses the bare href and will drop the portal project');

  // At least one carried link in EACH component. An exact total was brittle: the
  // "Projects" parent (2026-09-15) added a third, and a count is not the rule —
  // the rule is that no nav link is bare, which the assertion above checks.
  const sidebar = code.slice(code.indexOf('export function SidebarNav'), code.indexOf('export function MobileNav'));
  const mobile = code.slice(code.indexOf('export function MobileNav'));
  assert.match(sidebar, /href=\{portalHref\(item\.href, search\)\}/, 'SidebarNav must carry the portal project');
  assert.match(mobile, /href=\{portalHref\(item\.href, search\)\}/, 'MobileNav must carry the portal project');

  // And every portal link the LAYOUT renders itself. The change-order bell was
  // still a bare <Link href="/portal/change-orders"> after the nav was fixed.
  const layout = FILES.find((f) => rel(f.path) === 'app/portal/layout.tsx');
  assert.ok(layout, 'app/portal/layout.tsx has moved');
  const bareInLayout = withoutComments(layout.text).match(/<Link\b[^>]*href=["'`{]+\/portal/g) ?? [];
  assert.deepEqual(bareInLayout, [], 'a portal link in the layout drops the project — use <PortalLink>');
});

test('no source file carries an invisible control character', () => {
  // The bug that keeps coming back. Writing `\b` through a shell has, three
  // times now, landed a literal BACKSPACE (0x08) in a regex instead of a word
  // boundary. The file still parses, the regex still compiles, and it silently
  // never matches:
  //
  //   · 2026-09-0x — a guardrail that could never fail;
  //   · 2026-09-12 — the portal-link guardrail above, caught only because the
  //     bug it guards was reintroduced and nothing went red;
  //   · 2026-08-29 — scripts/build-wireframes.mjs, whose nav-coverage warning
  //     had never once fired.
  //
  // Nothing about the file looks wrong in an editor. This is the only check
  // that sees it. Tab, newline and carriage return are allowed; nothing else
  // below 0x20 has any business in source.
  const root = resolve(SRC, '../../..');
  const dirs = ['apps/web/src', 'packages/contracts/src', 'scripts', 'supabase'];
  const exts = new Set(['.ts', '.tsx', '.mjs', '.js', '.sql']);
  const control = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (exts.has(extname(entry.name))) {
        readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (control.test(line)) offenders.push(`${relative(root, full).replace(/\\/g, '/')}:${i + 1}`);
          });
      }
    }
  };
  for (const dir of dirs) walk(join(root, dir));

  assert.deepEqual(offenders, [], 'an invisible control character — almost certainly a shell-mangled \\b');
});

test('no screen prints a project id — only its code or its name', () => {
  // John, 2026-09-12: "make sure not display any project id that is random
  // strings". A crawl of all 130 routes that day found them in three shapes,
  // and each is refused here:
  //
  //   1. the id as page text        {row.project.buildsuiteProjectId}
  //   2. a fallback to the id        projectName ?? projectId   (six screens)
  //   3. a truncated id              buildsuiteProjectId.slice(0, 8)
  //
  // An id inside an ATTRIBUTE — href, key, value — is fine: nobody reads it.
  // The test looks only for it rendered as a JSX child, which is the one place
  // a person would.
  const offenders: string[] = [];
  for (const file of FILES) {
    const path = rel(file.path);
    if (!path.endsWith('.tsx') || !(path.startsWith('app/') || path.startsWith('components/'))) continue;
    // Comments blanked but their LINE BREAKS kept, so a reported line number
    // is the real one. `withoutComments` collapses a block comment to a single
    // space, which shifted every report below it — by 27 lines on the invoices
    // page when this was written.
    const code = file.text
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
      .replace(/\/\/[^\n]*/g, ' ');
    code.split('\n').forEach((line, i) => {
      const where = `${path}:${i + 1}`;
      // 1. `{...buildsuiteProjectId}` as a child: not after `=` (an attribute)
      //    and not after `$` (inside a template literal building a URL).
      if (/(^|[^=$\w])\{[\w.?!]*buildsuiteProjectId\}/.test(line)) offenders.push(`${where} renders the id`);
      // 2. a name that falls back to an id
      if (/\?\?\s*(?:[\w.]+\.)?projectId\b(?!\s*[:=])/.test(line) && !/href|key=|value=/.test(line)) {
        offenders.push(`${where} falls back to the id`);
      }
      // 3. a truncated id
      if (/buildsuiteProjectId\.(?:slice|substring)\(/.test(line)) offenders.push(`${where} truncates the id`);
    });
  }
  assert.deepEqual(offenders, [], 'show the code (ContractorProjectCode) or the name, never the id');
});

test('a homeowner never sees the award code', () => {
  // Sing, 2026-09-12: project_code is the CLIENT's code — the one the signature
  // automation emails them, the one they sign in with, the one their invoices
  // carry. award_code is the winning contractor's. Showing a homeowner
  // BSA-APS-003 for a job they know as BSA-053 is a code they have never been
  // given, on their own project.
  //
  // So nothing a homeowner reads may touch `awardCode` or `award_code`: the
  // portal, the sign-in door, emails, and the invoice reference (which lands
  // in their inbox). Contractor screens reach it only through
  // `lib/project-codes.ts` / <ContractorProjectCode>.
  const clientFacing = (path: string) =>
    path.startsWith('app/portal/') ||
    path.startsWith('app/signin/') ||
    // The one sign-in route: homeowners sign in here since 2026-09-15.
    path === 'app/page.tsx' ||
    path === 'app/login-form.tsx' ||
    path.startsWith('lib/email/') ||
    path.startsWith('lib/auth/') ||
    path.startsWith('lib/invoicing/') ||
    path === 'lib/portal-gates.ts' ||
    path === 'lib/portal-data.ts' ||
    path === 'lib/client-payment-schedule.ts' ||
    path === 'lib/ghl/email.ts';

  const offenders = FILES.filter(
    (f) => clientFacing(rel(f.path)) && /\bawardCode\b|\baward_code\b/.test(withoutComments(f.text)),
  ).map((f) => rel(f.path));
  assert.deepEqual(offenders, [], 'a client-facing file reads the award code');

  // And no contractor screen writes the COALESCE its own way.
  const inline = FILES.filter((f) => {
    const path = rel(f.path);
    if (path === 'lib/project-codes.ts' || path.startsWith('lib/buildsuite/') || path.startsWith('lib/data/')) return false;
    return /\.awardCode\b/.test(withoutComments(f.text));
  }).map((f) => rel(f.path));
  assert.deepEqual(inline, [], 'use contractorCode() / <ContractorProjectCode>, not awardCode directly');
});

test('every invoice preview shows the letterhead the invoice will actually carry', () => {
  // The review screen promises "what a contractor reads here is what GoHighLevel
  // receives". Since invoice templates (2026-09-12) can override the logo and
  // details, a preview fed the raw BuildSuite profile would show one logo while
  // the invoice carried another — silently. Every screen rendering
  // <InvoicePreview> must build its letterhead with `previewLetterhead`, the
  // same merge `createInvoiceOnRail` sends.
  const offenders = FILES.filter((f) => {
    const code = withoutComments(f.text);
    return /<InvoicePreview\b/.test(code) && !/previewLetterhead\(/.test(code);
  })
    .map((f) => rel(f.path))
    // The component's own file defines it; the sample page renders fixed demo data.
    .filter((path) => path !== 'components/invoice-preview.tsx' && !path.includes('/sample/'));

  assert.deepEqual(offenders, [], 'an invoice preview bypasses the template merge');

  // And the action that sends the invoice uses the same merge.
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);
  const send = actions.text.match(/export async function createInvoiceOnRail\([\s\S]*?\n\}/);
  assert.ok(send, 'createInvoiceOnRail has moved or been renamed');
  assert.match(send[0], /mergeLetterhead\(/, 'the invoice sent must use the same merge as the preview');
});

test('every navy shade used is defined in the theme', () => {
  // Tailwind emits NOTHING for a shade the theme does not define, and says
  // nothing about it. navy-300 and navy-500 were missing until 2026-09-15, so
  // 76 class uses across 30 files silently rendered in whatever colour they
  // inherited — and the sidebar's project sections came out navy-on-navy,
  // nearly invisible. The build passed and every test was green.
  //
  // Comments are stripped first, so a sentence NAMING a shade cannot trip this.
  const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8');
  const defined = new Set([...css.matchAll(/--color-navy-(\d+)\s*:/g)].map((m) => m[1]));

  const offenders: string[] = [];
  for (const file of FILES) {
    const code = withoutComments(file.text);
    for (const m of code.matchAll(/\bnavy-(\d{2,3})\b/g)) {
      if (!defined.has(m[1]!)) offenders.push(`${rel(file.path)} uses navy-${m[1]}`);
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    `navy shades defined: ${[...defined].join(', ')} — add the missing one to globals.css`,
  );
});
