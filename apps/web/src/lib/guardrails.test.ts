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

  // The publish path checks for a contractor explicitly. If that check ever
  // widens to include 'field', the approval model is gone.
  assert.match(
    actions.text,
    /reviewUpdate[\s\S]{0,400}role !== 'contractor'/,
    'reviewUpdate must refuse anyone who is not a contractor',
  );
  assert.match(
    actions.text,
    /updateVisibility[\s\S]{0,400}role !== 'contractor'/,
    'updateVisibility must refuse anyone who is not a contractor',
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

// ── Rule 4 · The Hub owns exactly one write ─────────────────────────────────
// D4 §5: "The PM decision buttons live in the Hub only — nothing in GHL.
// Deciding what a homeowner sees is the Hub's job. This is the one place the
// Hub owns the action."

test('D4 §5 — the mutating server actions are only the publish decision and session control', () => {
  const actions = FILES.find((f) => rel(f.path) === 'lib/actions.ts');
  assert.ok(actions);

  const exported = [...actions.text.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);

  // reviewUpdate + updateVisibility ARE the publish decision. submitFieldUpdate
  // is the crew proposing, which is the input to it. The rest is session
  // handling and demo scaffolding, which own no project data.
  const allowed = new Set([
    'reviewUpdate', // the decision itself
    'updateVisibility', // which clauses of the gate are open
    'submitFieldUpdate', // the crew proposes; it never publishes
    'signIn',
    'signOut',
    'viewAs',
    'returnToMyAccount',
    'toggleDemoData',
  ]);

  const unexpected = exported.filter((name) => !allowed.has(name));
  assert.deepEqual(
    unexpected,
    [],
    `new server action(s) ${unexpected.join(', ')} — the Hub owns one write; anything else must reflect GHL`,
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

// ── Rule 5 · Operational records belong to GHL after handoff ────────────────
// D1 p2, D2 §5, D3 §3, D4 §2. Our migration must not create a second home for
// them. See docs/SOURCE-OF-TRUTH.md C-1.

test('C-1 — the migration creates no table for a record GoHighLevel owns', () => {
  const sql = readFileSync(
    join(SRC, '..', '..', '..', 'supabase', 'migrations', '0001_hub_tables.sql'),
    'utf8',
  );

  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

  // What the Hub legitimately owns: its own decision, the gate's switches, and
  // media. Everything else is GHL's after handoff.
  assert.deepEqual(created.sort(), [
    'hub_media',
    'hub_publication_decisions',
    'hub_visibility_settings',
  ]);

  for (const owned of ['milestone', 'task', 'daily_update', 'message', 'selection', 'change_order', 'issue']) {
    assert.equal(
      created.some((t) => t.includes(owned)),
      false,
      `migration creates hub_*${owned}* — GoHighLevel owns that record after handoff`,
    );
  }
});

test('C-1 — every Hub table still enables row level security', () => {
  const sql = readFileSync(
    join(SRC, '..', '..', '..', 'supabase', 'migrations', '0001_hub_tables.sql'),
    'utf8',
  );

  const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  for (const table of created) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table}\\s+enable row level security`),
      `${table} has no RLS — the publishable key would read it from any browser`,
    );
  }
});

test('C-1 — the migration still creates only, and alters nothing of BuildSuite’s', () => {
  const sql = readFileSync(
    join(SRC, '..', '..', '..', 'supabase', 'migrations', '0001_hub_tables.sql'),
    'utf8',
  );

  // `alter table ... enable row level security` on our own tables is expected.
  // Anything else that alters, drops or truncates is not.
  const dangerous = sql
    .split('\n')
    .filter((line) => /^\s*(drop|truncate)\b/i.test(line) || /^\s*alter table/i.test(line))
    .filter((line) => !/enable row level security/i.test(line));

  assert.deepEqual(dangerous, [], 'the migration alters or drops something');
});
