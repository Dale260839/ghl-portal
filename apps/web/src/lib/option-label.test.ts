import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_OPTION_CHARS,
  distinctLabels,
  projectOptions,
  shortenLabel,
} from './option-label.ts';

/**
 * Project names in a dropdown a crew member opens on a phone.
 *
 * A native select popup is drawn by the browser and sizes itself to its
 * longest option, so the label length is the only thing that decides whether
 * it fits on the screen. These names are long and end in the part that tells
 * them apart.
 */

const BELLEVUE = 'General Remodeling / Additions project in Bellevue';
const REDMOND = 'General Remodeling / Additions project in Redmond';

test('a name that already fits is left exactly as it is', () => {
  assert.equal(shortenLabel('Test Project'), 'Test Project');
  assert.equal(shortenLabel(''), '');
  assert.equal(shortenLabel('  Padded  '), 'Padded');
});

test('§ a long name is shortened to something that fits', () => {
  const short = shortenLabel(BELLEVUE);
  assert.ok(BELLEVUE.length > MAX_OPTION_CHARS, 'the fixture stopped being long');
  assert.ok(short.length <= MAX_OPTION_CHARS, `"${short}" is ${short.length} characters`);
});

test('§ it removes the MIDDLE, because the end is what tells jobs apart', () => {
  // Truncating the tail turns "…in Bellevue" and "…in Redmond" into the same
  // string, and a crew member files their day against the wrong house.
  const short = shortenLabel(BELLEVUE);
  assert.ok(short.startsWith('General'), `lost the start: "${short}"`);
  assert.ok(short.endsWith('Bellevue'), `lost the end: "${short}"`);
  assert.ok(short.includes('…'), 'nothing marks what was removed');
});

test('§ two jobs that differ only at the end stay different', () => {
  const [a, b] = distinctLabels([BELLEVUE, REDMOND]);
  assert.notEqual(a, b, 'two different projects became the same option');
  assert.ok(a!.endsWith('Bellevue'));
  assert.ok(b!.endsWith('Redmond'));
});

test('§ a collision caused by shortening restores the full names', () => {
  // Contrived so the middle-removal cannot save it: identical at both ends.
  const one = 'Kitchen remodel at the FIRST house on Pine Street, unit A';
  const two = 'Kitchen remodel at the SECOND house on Pine Street, unit A';
  const [a, b] = distinctLabels([one, two], 20);
  assert.notEqual(a, b, 'shortening made two jobs indistinguishable');
  assert.equal(a, one, 'the full name is the fallback');
  assert.equal(b, two);
});

test('§ names that were already identical are not given a difference', () => {
  // Nothing here can invent information the data does not carry. Two jobs
  // genuinely called the same thing stay that way, shortened.
  const [a, b] = distinctLabels([BELLEVUE, BELLEVUE]);
  assert.equal(a, b);
  assert.ok(a!.length <= MAX_OPTION_CHARS, 'and it still fits');
});

test('a very small limit does not produce something unreadable', () => {
  // Below the point where both ends are worth keeping, the name is left whole
  // rather than reduced to punctuation.
  assert.equal(shortenLabel(BELLEVUE, 4), BELLEVUE);
});

test('§ the option keeps the id it submits and the full name it stands for', () => {
  // The VALUE is the project id, so shortening the label never changes what
  // gets written. `full` is what the tooltip shows.
  const options = projectOptions([
    { buildsuiteProjectId: 'p-1', projectName: BELLEVUE },
    { buildsuiteProjectId: 'p-2', projectName: 'Test Project' },
  ]);
  assert.deepEqual(
    options.map((o) => o.value),
    ['p-1', 'p-2'],
  );
  assert.equal(options[0]?.full, BELLEVUE);
  assert.ok(options[0]!.label.length <= MAX_OPTION_CHARS);
  assert.equal(options[1]?.label, 'Test Project');
});
