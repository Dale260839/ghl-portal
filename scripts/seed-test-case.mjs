/**
 * Seeds one walkthrough's worth of records into the Hub's database.
 *
 *   node scripts/seed-test-case.mjs          # create
 *   node scripts/seed-test-case.mjs --remove # delete everything it created
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The Hub's tables are real and empty. Nobody has filed a field update, so the
 * review queue and the whole client portal render their empty state — which is
 * honest, and useless for showing anyone how the product works.
 *
 * So: real ids, real projects, real contractor, and content that is obviously
 * labelled as a test. Every row it writes is prefixed `[TEST CASE]` and carries
 * a marker, so `--remove` takes it all back out and nobody has to guess later
 * which rows were seeded and which were somebody's actual work.
 *
 * **It writes ONLY to the Hub's database.** BuildSuite is read to fetch the
 * project and contractor ids and is never written to.
 * ---------------------------------------------------------------------------
 *
 * TWO PROJECTS, ONE SIGNED AND ONE NOT, because the difference is the product:
 * a signed job is work to manage, an unsigned one is a quote that might die.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(resolve(REPO, 'apps/web/.env.local'), 'utf8');
const read = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1]?.trim();

const HUB = read('HUB_SUPABASE_URL');
const HUB_KEY = read('HUB_SUPABASE_KEY');
if (!HUB || !HUB_KEY) throw new Error('HUB_SUPABASE_URL / HUB_SUPABASE_KEY missing');

const H = {
  apikey: HUB_KEY,
  Authorization: `Bearer ${HUB_KEY}`,
  'Content-Type': 'application/json',
};

async function hub(method, path, body) {
  const res = await fetch(`${HUB}/rest/v1/${path}`, {
    method,
    headers: { ...H, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text === '' ? [] : JSON.parse(text);
}

// ── The real ids, verified against the live database 2026-09-01 ─────────────

/** AFC — ralph@alliance4contractors.com. Holds the only signed proposal. */
const CONTRACTOR = '5dd312bd-0b95-45af-be7b-c19a14eff103';

/**
 * SIGNED. Four proposals on it carry `signature_status = SIGNED` with Adobe
 * agreement ids, February 2026. Its `projects` row is hidden from our key by
 * RLS, which is exactly why it is worth having in a test case: the Hub has to
 * cope with a job it can manage but cannot name.
 */
const SIGNED_PROJECT = '87a42c43-0f0e-4d2b-b07d-65311aa04d29';

/** NOT SIGNED. A real project of Ralph's, readable, with a real client. */
const UNSIGNED_PROJECT = 'd3a27b92-7630-4c19-a026-0f6339ca2887';
const CLIENT_NAME = 'Zander Garcia';
const CLIENT_EMAIL = 'zandergarcia552@gmail.com';

const TAG = '[TEST CASE]';
const remove = process.argv.includes('--remove');

// ── Remove ──────────────────────────────────────────────────────────────────

if (remove) {
  // Matched on the label rather than on ids kept in a file, so this works even
  // if it is run from a different machine weeks later.
  const targets = [
    ['hub_daily_updates', `work_completed=ilike.${encodeURIComponent(TAG)}*`],
    ['hub_milestones', `milestone_name=ilike.${encodeURIComponent(TAG)}*`],
    ['hub_tasks', `task_name=ilike.${encodeURIComponent(TAG)}*`],
    ['hub_issues', `issue_title=ilike.${encodeURIComponent(TAG)}*`],
    ['hub_memberships', `full_name=ilike.${encodeURIComponent(TAG)}*`],
    ['hub_activity', `summary=ilike.${encodeURIComponent(TAG)}*`],
  ];
  for (const [table, filter] of targets) {
    await hub('DELETE', `${table}?${filter}`);
    console.log(`removed  ${table}`);
  }
  console.log('\nTest case removed. Any records not labelled', TAG, 'were left alone.');
  process.exit(0);
}

// ── Create ──────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
// `created_by` exists on milestones and tasks; daily updates carry
// `submitted_by` and issues carry `raised_by` instead. Two bases rather than
// one, so a spread cannot put a column on a table that has no such column.
const base = { contractor_id: CONTRACTOR, created_by: `${TAG} seed` };
const owned = { contractor_id: CONTRACTOR };

console.log('Seeding the Hub database.');
console.log('  contractor      ', CONTRACTOR, '(AFC, ralph@alliance4contractors.com)');
console.log('  signed project  ', SIGNED_PROJECT);
console.log('  unsigned project', UNSIGNED_PROJECT, `(${CLIENT_NAME})`);
console.log();

// ── The signed job: work in progress, with a published update ──────────────

const milestones = await hub('POST', 'hub_milestones', [
  { ...base, project_id: SIGNED_PROJECT, milestone_name: `${TAG} Demolition`, sequence: 1, status: 'Completed', client_visible: true, planned_start: '2026-08-10', planned_end: '2026-08-14' },
  { ...base, project_id: SIGNED_PROJECT, milestone_name: `${TAG} Framing`, sequence: 2, status: 'In Progress', client_visible: true, planned_start: '2026-08-17', planned_end: '2026-09-04' },
  { ...base, project_id: SIGNED_PROJECT, milestone_name: `${TAG} Final inspection`, sequence: 3, status: 'Not Started', client_visible: false, planned_start: '2026-09-07', planned_end: '2026-09-11' },
]);
console.log('milestones  ', milestones.length, '(one of them internal, to show the switch works)');

const tasks = await hub('POST', 'hub_tasks', [
  { ...base, project_id: SIGNED_PROJECT, task_name: `${TAG} Book the framing inspection`, assigned_trade: 'General', pm_note: 'Tuesday if the inspector has room.', status: 'Not Started', assigned_at: new Date().toISOString() },
  { ...base, project_id: SIGNED_PROJECT, task_name: `${TAG} Order replacement tile`, assigned_trade: 'Tiling', pm_note: 'The first delivery was the wrong colour.', status: 'In Progress', assigned_at: new Date().toISOString() },
]);
console.log('tasks       ', tasks.length, '(both assigned, so the field badge has something to show)');

// The pair that carries the whole argument: what the crew wrote, and what the
// homeowner reads. Separate columns, and nothing copies one into the other.
const published = await hub('POST', 'hub_daily_updates', [
  {
    ...owned,
    project_id: SIGNED_PROJECT,
    update_date: today,
    submitted_by: 'Field crew',
    work_completed: `${TAG} Framing finished on the north wall.`,
    crew_onsite: 3,
    hours_worked: 8,
    weather: 'Clear',
    internal_notes:
      'Tile arrived in the wrong colour again. Supplier has let us down twice now and it cost us most of a day. Do not put this in front of the client.',
    client_summary:
      'Framing on the north wall is complete. The inspection is booked and we are on track for the dates we agreed.',
    manager_approval_status: 'Approved & Published',
    client_visible: true,
    published_date: today,
  },
]);
console.log('published   ', published.length, 'update  <- the homeowner sees the summary, never the note');

const internal = await hub('POST', 'hub_daily_updates', [
  {
    ...owned,
    project_id: SIGNED_PROJECT,
    update_date: today,
    submitted_by: 'Field crew',
    work_completed: `${TAG} Site tidy and material check.`,
    crew_onsite: 1,
    hours_worked: 3,
    weather: 'Overcast',
    internal_notes: 'Half a day lost waiting on the supplier. Recorded, not reported.',
    client_summary: '',
    // Reads like approval in English and is deliberately NOT client-facing.
    manager_approval_status: 'Approved Internally',
    client_visible: false,
  },
]);
console.log('internal    ', internal.length, 'update  <- "Approved Internally" stays hidden');

const pending = await hub('POST', 'hub_daily_updates', [
  {
    ...owned,
    project_id: SIGNED_PROJECT,
    update_date: today,
    submitted_by: 'Field crew',
    work_completed: `${TAG} Insulation started in the back bedroom.`,
    crew_onsite: 2,
    hours_worked: 6,
    weather: 'Clear',
    internal_notes: 'Client asked about the tile again. Someone should call them.',
    client_summary: '',
    manager_approval_status: 'Pending',
    client_visible: false,
    client_decision_needed: true,
  },
]);
console.log('pending     ', pending.length, 'update  <- sits in the PM review queue with nothing published');

const issues = await hub('POST', 'hub_issues', [
  { ...owned, project_id: SIGNED_PROJECT, issue_title: `${TAG} Wrong tile colour delivered`, category: 'Materials', description: 'Second delivery in the wrong colour.', priority: 'Normal', status: 'Open', raised_by: 'Field crew', raised_by_role: 'field', internal_notes: 'Supplier fault. Chasing a credit.', client_update: 'We are replacing some tile that arrived in the wrong colour. It does not affect your dates.', client_visible: true },
]);
console.log('issues      ', issues.length, '(internal note and client wording are different text)');

// ── The unsigned job: quoted, nothing to manage yet ────────────────────────

const quoted = await hub('POST', 'hub_milestones', [
  { ...base, project_id: UNSIGNED_PROJECT, milestone_name: `${TAG} Awaiting signature`, sequence: 1, status: 'Not Started', client_visible: false },
]);
console.log('unsigned    ', quoted.length, 'milestone (internal only - nothing is agreed yet)');

// ── A client to sign in as ──────────────────────────────────────────────────

const member = await hub('POST', 'hub_memberships', [
  {
    contractor_id: CONTRACTOR,
    email: CLIENT_EMAIL,
    full_name: `${TAG} ${CLIENT_NAME}`,
    role: 'client',
    project_ids: [SIGNED_PROJECT],
    invited_by: `${TAG} seed`,
  },
]);
console.log('client      ', member.length, `membership for ${CLIENT_EMAIL} (invited, not yet activated)`);

await hub('POST', 'hub_activity', [
  { contractor_id: CONTRACTOR, project_id: SIGNED_PROJECT, actor: 'Seed script', actor_role: 'contractor', action: 'create', resource: 'test-case', summary: `${TAG} seeded a walkthrough` },
]);

console.log(`
Done. Sign in as the contractor and you should now see:

  Active Work        the signed job, with real records against it
  Field Updates      1 pending in the review queue
  Project detail     3 milestones, 2 tasks, 1 issue

  Client portal      the published update only. The supplier complaint is in
                     internal_notes on the same row and never crosses.

Everything is labelled ${TAG}. Remove it with:

  node scripts/seed-test-case.mjs --remove
`);
