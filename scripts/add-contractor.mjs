/**
 * Give someone a contractor login on the Hub.
 *
 *   node scripts/add-contractor.mjs <email> <password> [--name "Their Name"]
 *   node scripts/add-contractor.mjs <email> --remove
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A BUTTON
 *
 * A contractor cannot invite another contractor from the Team screen, and that
 * is deliberate: who counts as a contractor is an account-level decision, not
 * something a colleague hands out. So creating one is a deliberate act by
 * somebody with access to this repository and the database, which is the right
 * bar for it.
 *
 * It writes ONLY to the Hub's database. BuildSuite is read to find which auth
 * profile and contractor record the person should map to, and is never written.
 *
 * ---------------------------------------------------------------------------
 * THE TWO IDS, AND WHY BOTH ARE STORED
 *
 *   contractor_id     whose team, and the key the Hub's own tables use
 *   auth_profile_ids  what they may read on the BuildSuite side
 *
 * They are different ids. A contractor needs both: their projects and proposals
 * live in BuildSuite behind `auth_profiles.id`, and their milestones and field
 * updates live here behind `contractor_id`.
 * ---------------------------------------------------------------------------
 */

import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = readFileSync(resolve(REPO, 'apps/web/.env.local'), 'utf8');
const read = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1]?.trim();

const BS = read('SUPABASE_URL');
const BS_KEY = read('SUPABASE_ANON_KEY');
const HUB = read('HUB_SUPABASE_URL');
const HUB_KEY = read('HUB_SUPABASE_KEY');

const [, , emailArg, passwordArg, ...rest] = process.argv;
const email = (emailArg ?? '').trim().toLowerCase();
const removing = process.argv.includes('--remove');
const nameFlag = rest.indexOf('--name');
const fullName = nameFlag === -1 ? '' : (rest[nameFlag + 1] ?? '');

if (email === '' || !email.includes('@')) {
  console.error('usage: node scripts/add-contractor.mjs <email> <password> [--name "Name"]');
  process.exit(1);
}

const hdr = (key) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' });

async function call(baseUrl, key, method, path, body) {
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    headers: { ...hdr(key), Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text === '' ? [] : JSON.parse(text);
}

const bs = (m, p, b) => call(BS, BS_KEY, m, p, b);
const hub = (m, p, b) => call(HUB, HUB_KEY, m, p, b);

// Fail early with the fix rather than deep inside an insert. Postgres reports a
// missing column as 42703 and PostgREST as PGRST204 depending on the verb, so
// both are checked — matching on the prose alone missed it once already.
{
  const probe = await fetch(`${HUB}/rest/v1/hub_memberships?select=auth_profile_ids&limit=1`, {
    headers: hdr(HUB_KEY),
  });
  const body = await probe.text();
  if (!probe.ok || /42703|PGRST204|does not exist/.test(body)) {
    console.error([
      '',
      'hub_memberships.auth_profile_ids is missing.',
      'Run supabase/hub/0004_membership_auth_profiles.sql first:',
      '',
      '  alter table public.hub_memberships',
      "    add column if not exists auth_profile_ids uuid[] not null default '{}';",
      '',
    ].join('\n'));
    process.exit(1);
  }
}

if (removing) {
  await hub('DELETE', `hub_memberships?email=eq.${encodeURIComponent(email)}&role=eq.contractor`);
  console.log('removed the contractor membership for', email);
  process.exit(0);
}

if ((passwordArg ?? '').length < 10) {
  console.error('a password of at least 10 characters is required');
  process.exit(1);
}

// Same format `lib/hub-db/team.ts` verifies against: scrypt, per-password salt,
// cost stored alongside so it can be raised later without invalidating anyone.
function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16_384 });
  return `scrypt$16384$${salt.toString('hex')}$${derived.toString('hex')}`;
}

// ── Which contractor and which profile? ─────────────────────────────────────

console.log('Looking up', email, 'in BuildSuite…');

const ownProfile = await bs('GET', `auth_profiles?email=eq.${encodeURIComponent(email)}&select=id,contractor_id,user_type`);
const ownContractor = await bs('GET', `contractors?email=eq.${encodeURIComponent(email)}&select=id,business_name`);

let contractorId = null;
let authProfileIds = [];
let via = '';

if (ownContractor.length === 1) {
  contractorId = ownContractor[0].id;
  via = 'their own contractor record';
}
if (ownProfile.length > 0) {
  authProfileIds = ownProfile.map((p) => p.id);
  if (contractorId === null && ownProfile[0].contractor_id) {
    contractorId = ownProfile[0].contractor_id;
    via = 'their own auth profile';
  }
}

// Not in BuildSuite at all. Fall back to the company on the email domain, so
// somebody at a firm that already exists gets that firm's book of work rather
// than an empty screen. Stated loudly, because it is an assumption.
if (contractorId === null) {
  const domain = email.split('@')[1];
  const colleagues = await bs(
    'GET',
    `auth_profiles?email=like.*@${domain}&select=id,email,contractor_id&contractor_id=not.is.null`,
  );
  if (colleagues.length > 0) {
    contractorId = colleagues[0].contractor_id;
    authProfileIds = [colleagues[0].id];
    via = `the domain @${domain}, matching ${colleagues[0].email}`;
    console.log(`\n  ! ${email} is not in BuildSuite.`);
    console.log(`  ! Using the contractor and profile belonging to ${colleagues[0].email}.`);
    console.log('  ! They will see that company\'s work. Correct this if it is wrong.\n');
  }
}

if (contractorId === null) {
  console.error(`\nCould not work out which contractor ${email} belongs to.`);
  console.error('Nobody at that domain has a contractor record, and the address is not in');
  console.error('BuildSuite. Pass the ids explicitly by editing this script, or ask');
  console.error('BuildSuite to add the profile first.');
  process.exit(1);
}

const [company] = await bs('GET', `contractors?id=eq.${contractorId}&select=business_name,email`);

console.log('  contractor_id   ', contractorId, company ? `(${company.business_name})` : '');
console.log('  auth_profile_ids', authProfileIds.join(', ') || '(none)');
console.log('  matched via     ', via);

if (authProfileIds.length === 0) {
  console.log('\n  ! No auth profile, so BuildSuite reads will return nothing.');
  console.log('  ! Hub records will still work. Expect an empty projects list.\n');
}

// ── Write the membership ────────────────────────────────────────────────────

await hub('DELETE', `hub_memberships?email=eq.${encodeURIComponent(email)}&role=eq.contractor`);

const [member] = await hub('POST', 'hub_memberships', [
  {
    contractor_id: contractorId,
    auth_profile_ids: authProfileIds,
    email,
    full_name: fullName || email.split('@')[0],
    role: 'contractor',
    // Activated immediately: there is no invitation to accept, because the
    // person running this script is the one granting the access.
    activated_at: new Date().toISOString(),
    password_hash: hashPassword(passwordArg),
    invited_by: 'add-contractor script',
  },
]);

console.log(`
Done. Sign in at the front page with:

  email     ${email}
  password  (the one you passed)

Use the "Or sign in with your account" fields, not the demo identities above
them. Remove this login again with:

  node scripts/add-contractor.mjs ${email} --remove

membership ${member.id}
`);
