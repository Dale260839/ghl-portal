import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_SECTIONS } from './project-nav.ts';

/**
 * Every project section has an icon.
 *
 * Collapsed, the icon is the entire row — there is no label beside it to carry
 * the meaning. A section added to `PROJECT_SECTIONS` without a matching entry
 * in `SECTION_ICONS` therefore ships as a blank square that navigates
 * somewhere, which is worse than a missing link because it looks like a bug in
 * the browser rather than a gap in the code.
 *
 * Bundled rather than imported: the icons are JSX, and the section list is
 * deliberately a pure module. This test is the seam between them.
 */
async function sectionIcons(): Promise<Record<string, unknown>> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const output = await build({
    stdin: {
      contents: `export { SECTION_ICONS } from './src/components/nav-icons.tsx';`,
      resolveDir: root,
    },
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
  });
  const module = (await import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.contents).toString('base64')}`
  )) as { SECTION_ICONS: Record<string, unknown> };
  return module.SECTION_ICONS;
}

test('§ every section the sidebar renders has an icon to render', async () => {
  const icons = await sectionIcons();
  const missing = PROJECT_SECTIONS.filter((s) => icons[s.seg] === undefined).map((s) => s.label);
  assert.deepEqual(missing, [], `sections with no icon: ${missing.join(', ')}`);
});

test('§ Overview is keyed on the empty segment, not forgotten for being falsy', () => {
  // `''` is a real segment — the project's own summary. A lookup written as
  // `icons[seg] || fallback`, or a map that skipped it as "empty", would leave
  // the one section a contractor lands on first without a picture.
  assert.equal(PROJECT_SECTIONS[0]?.seg, '');
});

test('no icon is defined for a section that does not exist', async () => {
  // The other direction. A stale key is a section somebody removed and an icon
  // nobody deleted, and it quietly suggests the list is longer than it is.
  const icons = await sectionIcons();
  const segs = new Set(PROJECT_SECTIONS.map((s) => s.seg));
  const orphans = Object.keys(icons).filter((key) => !segs.has(key));
  assert.deepEqual(orphans, [], `icons with no section: ${orphans.join(', ')}`);
});
