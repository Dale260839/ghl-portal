/**
 * Generate today's check-in, pre-filled with everything measurable.
 *
 *   npm run checkin           write docs/checkins/YYYY-MM-DD.md
 *   npm run checkin -- --dry  print it instead
 *
 * ---------------------------------------------------------------------------
 * WHY A SCRIPT AND NOT A TEMPLATE FILE
 *
 * A check-in that has to be assembled by hand gets skipped on exactly the days
 * worth recording — the long ones. Every number below is something a person
 * would otherwise look up, get slightly wrong, or leave out: the test count,
 * whether the remotes are level, what is uncommitted, which migrations exist.
 *
 * So the script fills in the facts and leaves the judgement blank. What it
 * cannot know — what moved, what is stuck, what you need from someone — is
 * where the cursor lands.
 *
 * It reads git and the filesystem only. NO NETWORK: a check-in must be
 * writable on a train, and the two Supabase hosts were unreachable from this
 * machine for a stretch on 2026-09-10 while everything else worked fine.
 * ---------------------------------------------------------------------------
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry');

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const today = new Date().toISOString().slice(0, 10);

// ── What git knows ───────────────────────────────────────────────────────────

const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '(unknown)';
const head = git('rev-parse', '--short', 'HEAD') || '(none)';

/** Commits authored today, on this branch. */
const commitsToday = git('log', '--oneline', `--since=${today}T00:00:00`, '--no-merges')
  .split('\n')
  .filter(Boolean);

/** Uncommitted work, so a check-in cannot claim a clean tree that is not. */
const dirty = git('status', '--porcelain').split('\n').filter(Boolean);

/**
 * Both remotes, because this repo has two and being level with one says
 * nothing about the other. Not fetched here — fetching is a network call and a
 * stale answer labelled stale beats a check-in that will not run offline.
 */
const remotes = git('remote').split('\n').filter(Boolean);
const divergence = remotes.map((remote) => {
  const counts = git('rev-list', '--left-right', '--count', `HEAD...${remote}/${branch}`);
  const [ahead, behind] = counts.split(/\s+/);
  return counts === ''
    ? `${remote}/${branch} — no tracking ref`
    : `${remote}/${branch} — ${ahead} ahead, ${behind} behind`;
});

/** Files touched today, most-changed first. Says where the day actually went. */
const touched = git('diff', '--stat', `HEAD@{${today}T00:00:00}`, 'HEAD')
  .split('\n')
  .filter(Boolean)
  .slice(-1)[0] ?? '(nothing since midnight)';

// ── What the filesystem knows ────────────────────────────────────────────────

/** Test files, as a rough surface measure. The real count comes from a run. */
function countTests(dir, acc = { files: 0, cases: 0 }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) countTests(full, acc);
    else if (/\.test\.tsx?$/.test(entry.name)) {
      acc.files += 1;
      acc.cases += (readFileSync(full, 'utf8').match(/^\s*(void )?test\(/gm) ?? []).length;
    }
  }
  return acc;
}
const tests = countTests(ROOT);

const migrations = existsSync(join(ROOT, 'supabase/hub'))
  ? readdirSync(join(ROOT, 'supabase/hub')).filter((f) => f.endsWith('.sql')).sort()
  : [];

/**
 * The standing blocker list, carried forward verbatim.
 *
 * Copied in rather than linked, on purpose. A blocker in a file nobody opens is
 * not tracked, it is filed — and the whole point of a daily check-in is that
 * the same item appearing five days running becomes impossible to ignore.
 */
const blockersPath = join(ROOT, 'docs/BLOCKERS.md');
const blockerLines = existsSync(blockersPath)
  ? readFileSync(blockersPath, 'utf8')
      .split('\n')
      .filter((line) => /^\|\s*(🔴|🟡)/.test(line))
  : [];

/**
 * RED IN FULL, AMBER AS A COUNT.
 *
 * The first version copied all twelve rows into every check-in. That is a wall
 * of table at the top of a document meant to be read in a minute, and a wall of
 * table gets skimmed — which defeats the point of copying anything in.
 *
 * Red means somebody cannot work or something is unsafe, so it gets the whole
 * row. Amber has a workaround by definition, so it gets a count and the file.
 */
const red = blockerLines.filter((line) => line.includes('🔴'));
const amber = blockerLines.filter((line) => line.includes('🟡'));

const TABLE_HEAD =
  '| | Blocker | Waiting on | Since | Cost of leaving it |\n|---|---|---|---|---|';

const blockerSection =
  blockerLines.length === 0
    ? '_No standing blockers recorded in docs/BLOCKERS.md._'
    : [
        red.length === 0 ? '_Nothing red._' : `${TABLE_HEAD}\n${red.join('\n')}`,
        '',
        `${amber.length} amber blocker(s) carried — see [docs/BLOCKERS.md](../BLOCKERS.md).`,
      ].join('\n');

/**
 * When the remote refs were last updated.
 *
 * The ahead/behind counts above are only as current as the last fetch, and this
 * script deliberately does not fetch. A check-in that says "0 behind" from a
 * three-day-old ref is worse than one that says nothing: it is a fact-shaped
 * statement that happens to be false.
 */
const lastFetch = (() => {
  const path = join(ROOT, '.git/FETCH_HEAD');
  if (!existsSync(path)) return 'never fetched';
  const hours = Math.floor((Date.now() - statSync(path).mtime.getTime()) / 3_600_000);
  return hours < 1 ? 'fetched within the hour' : `last fetched ${hours}h ago`;
})();

// ── The check-in ─────────────────────────────────────────────────────────────

const body = `# Check-in — ${today}

**Branch:** \`${branch}\` at \`${head}\`
**Commits today:** ${commitsToday.length}
${divergence.map((d) => `**Remote:** ${d}`).join('\n')}
_${lastFetch} — run \`git fetch --all\` before trusting those two lines._
**Working tree:** ${dirty.length === 0 ? 'clean' : `${dirty.length} uncommitted file(s)`}
**Tests:** ${tests.cases} cases across ${tests.files} files *(surface count — run \`npm test\` for the real number)*
**Migrations present:** ${migrations.length === 0 ? '(none)' : `${migrations[0]} … ${migrations.at(-1)}`}

---

## 1 · What moved

${commitsToday.length === 0 ? '_No commits yet today._' : commitsToday.map((c) => `- ${c}`).join('\n')}

${touched === '(nothing since midnight)' ? '' : `\`${touched.trim()}\`\n`}
<!-- In your own words: what is actually DONE, not what was worked on.
     "Done" means merged, tested, and someone else could use it. -->

## 2 · What is blocked

${blockerSection}

<!-- Add anything new. A blocker is something you cannot resolve alone.
     Name WHO it is waiting on and SINCE WHEN, or it is not a blocker, it is
     a task you have not started. -->

## 3 · What needs a decision

<!-- Different from blocked. This is where you have an answer but it is not
     yours to give: a schema question, a product call, a 16 open decision.
     Say what you would do if nobody answers, and by when you need to. -->

## 4 · Next

<!-- One to three things. If it is more than three, the first one is not
     small enough. -->

## 5 · Anything that surprised you

<!-- Optional, and the most valuable section over time. A number that was not
     what you expected, a test that passed for the wrong reason, a piece of
     data that contradicts an assumption. This is where the real findings in
     this project have come from. -->
`;

if (DRY) {
  console.log(body);
} else {
  const dir = join(ROOT, 'docs/checkins');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${today}.md`);
  if (existsSync(path)) {
    console.log(`${path} already exists — not overwriting. Open it, or use --dry.`);
    process.exitCode = 0;
  } else {
    writeFileSync(path, body, 'utf8');
    console.log(`wrote docs/checkins/${today}.md`);
  }
}
