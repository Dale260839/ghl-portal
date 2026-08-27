/**
 * Every test file must actually be run.
 *
 * `npm test` names its directories explicitly rather than recursing, which is
 * fine until someone adds a test in a directory that is not on the list. Then
 * the file looks like coverage, passes review, and never executes — which is
 * worse than having no test at all, because it reads as a guarantee.
 *
 * That happened: `src/lib/hud/script.test.ts` was written and the glob did not
 * include `src/lib/hud/`, so it silently never ran. This test fails the moment
 * it happens again.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** src/lib/test-manifest.test.ts -> apps/web */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function testGlobs(): string[] {
  const pkg = JSON.parse(readFileSync(join(WEB_ROOT, 'package.json'), 'utf8')) as {
    scripts?: { test?: string };
  };
  const script = pkg.scripts?.test ?? '';
  return script.split(/\s+/).filter((token) => token.endsWith('.test.ts'));
}

function testFilesOnDisk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) testFilesOnDisk(full, found);
    else if (entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/** Only `*` needs handling — the globs are all `<dir>/*.test.ts`. */
function globMatches(glob: string, path: string): boolean {
  const pattern = glob
    .split('/')
    .map((seg) => seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('/');
  return new RegExp(`^${pattern}$`).test(path);
}

test('every test file on disk is matched by an npm test glob', () => {
  const globs = testGlobs();
  assert.ok(globs.length > 0, 'could not read any test globs from package.json');

  const onDisk = testFilesOnDisk(join(WEB_ROOT, 'src')).map((p) =>
    relative(WEB_ROOT, p).split('\\').join('/'),
  );
  assert.ok(onDisk.length > 0, 'found no test files on disk — the walk is wrong');

  const unrun = onDisk.filter((file) => !globs.some((g) => globMatches(g, file)));
  assert.deepEqual(
    unrun,
    [],
    `these test files exist but are never run — add their directory to the "test" script in apps/web/package.json:\n  ${unrun.join('\n  ')}`,
  );
});

test('every npm test glob points at a directory that has test files', () => {
  // The mirror of the above: a glob left behind after files move matches
  // nothing, and `node --test` treats an unmatched path as an error on some
  // shells. Keeps the list honest in both directions.
  const onDisk = testFilesOnDisk(join(WEB_ROOT, 'src')).map((p) =>
    relative(WEB_ROOT, p).split('\\').join('/'),
  );
  for (const glob of testGlobs()) {
    assert.ok(
      onDisk.some((file) => globMatches(glob, file)),
      `the test glob "${glob}" matches no files — remove it or fix the path`,
    );
  }
});
