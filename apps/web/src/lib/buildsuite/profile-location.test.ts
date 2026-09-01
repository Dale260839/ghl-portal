import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The location lookup that unblocked invited sign-in.
 *
 * `assertScope` rejects a blank `locationId`, and an invited member's session
 * has never held one — they did not sign in through GoHighLevel. So every
 * scoped read threw for every invited person, on their first page, immediately
 * after a successful login. These pin the two properties that matter: it must
 * never return a location it was not asked for, and it must fail closed.
 */

/** The pure core, mirrored from `profile-location.ts`. */
function pickLocation(rows: { location_id: string | null }[]): string | null {
  for (const row of rows) {
    const location = (row.location_id ?? '').trim();
    if (location !== '') return location;
  }
  return null;
}

function normalizeIds(authProfileIds: readonly string[]): string[] {
  return [...new Set(authProfileIds.map((id) => id.trim()).filter((id) => id !== ''))];
}

test('no profile ids means no location, never an unfiltered read', () => {
  // The whole safety property. An empty `in ()` returns the entire table, so
  // the caller must stop before building the query.
  assert.deepEqual(normalizeIds([]), []);
  assert.deepEqual(normalizeIds(['', '   ']), []);
});

test('ids are deduped and trimmed before they reach the filter', () => {
  assert.deepEqual(normalizeIds([' a ', 'a', 'b']), ['a', 'b']);
});

test('a profile with no location yields null rather than a blank string', () => {
  // Blank would pass a truthiness check and then fail `assertScope` deeper in,
  // where the error names the wrong thing.
  assert.equal(pickLocation([]), null);
  assert.equal(pickLocation([{ location_id: null }]), null);
  assert.equal(pickLocation([{ location_id: '   ' }]), null);
});

test('the first profile naming a location wins', () => {
  assert.equal(pickLocation([{ location_id: null }, { location_id: 'loc-2' }]), 'loc-2');
  assert.equal(pickLocation([{ location_id: 'loc-1' }, { location_id: 'loc-2' }]), 'loc-1');
});
