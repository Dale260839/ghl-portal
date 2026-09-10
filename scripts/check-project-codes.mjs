/**
 * Verify the project-numbering convention against live BuildSuite.
 *
 * The whole string being unique is what §3.6 depends on as the only join key,
 * and what the homeowner sign-in depends on as a password. Nothing in
 * BuildSuite enforces it across the two counters, so this checks it.
 *
 *   node scripts/check-project-codes.mjs
 *
 * Read-only. Exits non-zero on anything that would lock a homeowner out or
 * point a join at the wrong project, so it can be wired into CI later.
 */
process.loadEnvFile('apps/web/.env.local');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  process.exit(2);
}

// The contract is imported AFTER the read completes. Importing it first leaves
// the type-stripping loader's handle open across the fetch, and Node aborts
// inside libuv at teardown on Windows — which set a nonzero exit code on a run
// that had actually passed, making the script useless as a CI gate.
const rows = await (
  await fetch(
    `${url}/rest/v1/projects?select=id,project_code,client_email,auth_profile_id,deleted_at&limit=2000`,
    // `Connection: close` so no keep-alive socket is left open at teardown —
    // Node aborts inside libuv on Windows if one is, and the abort sets a
    // nonzero exit code on a run that actually passed.
    { headers: { apikey: key, Authorization: `Bearer ${key}`, Connection: 'close' } },
  )
).json();

const { duplicateProjectCodes, isProjectCode, normalizeProjectCode, projectCodePrefix, projectCodeSeries } =
  await import('../packages/contracts/src/ids.ts');

const live = rows.filter((r) => !r.deleted_at);
const coded = live.filter((r) => r.project_code);
const codes = coded.map((r) => String(r.project_code));

let failures = 0;
const fail = (msg) => { failures += 1; console.error(`  FAIL  ${msg}`); };
const ok = (msg) => console.log(`  ok    ${msg}`);

console.log(`\nprojects ${live.length} live, ${coded.length} with a code\n`);

// 1 · The property everything depends on.
const dupes = duplicateProjectCodes(codes);
if (dupes.length === 0) ok('every code is unique');
else fail(`duplicate codes, which locks those homeowners out: ${dupes.join(', ')}`);

// 2 · Anything the contract would refuse is a code nobody can sign in with.
const malformed = codes.filter((c) => !isProjectCode(normalizeProjectCode(c)));
if (malformed.length === 0) ok('every code matches PROJECT_CODE_PATTERN');
else fail(`codes the contract rejects: ${malformed.join(', ')}`);

// 3 · A prefix minted by two different contractors is a collision waiting to
//     happen, because the two counters behind it run independently.
const owners = new Map();
for (const r of coded) {
  const prefix = projectCodePrefix(String(r.project_code));
  if (prefix === '') continue;
  const set = owners.get(prefix) ?? new Set();
  set.add(r.auth_profile_id ?? 'null');
  owners.set(prefix, set);
}
const shared = [...owners].filter(([, s]) => s.size > 1);
if (shared.length === 0) ok(`${owners.size} contractor prefix(es), none shared`);
else fail(`prefix used by more than one contractor: ${shared.map(([p, s]) => `${p} (${s.size})`).join(', ')}`);

// 4 · A code with no address to match it is a portal nobody can open. Not
//     fatal — it is a BuildSuite data gap, and the door fails closed.
const noEmail = coded.filter((r) => !r.client_email).map((r) => r.project_code);
if (noEmail.length === 0) ok('every coded project has a client email');
else console.warn(`  warn  coded but no client_email, so no sign-in: ${noEmail.join(', ')}`);

// 5 · Where each series has reached.
const bySeries = { alliance: [], contractor: [] };
for (const c of codes) {
  const series = projectCodeSeries(c);
  if (series) bySeries[series].push(c);
}
const highest = (list) => list.map((c) => Number(c.match(/(\d+)$/)[1])).sort((a, b) => b - a)[0] ?? 0;
console.log(
  `\n  alliance series   ${String(bySeries.alliance.length).padStart(3)} codes, highest ${highest(bySeries.alliance)}` +
  `\n  contractor series ${String(bySeries.contractor.length).padStart(3)} codes, highest ${highest(bySeries.contractor)}`,
);

console.log(failures === 0 ? '\nconvention holds\n' : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
