import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupByMonth, photoCount } from './photo-groups.ts';

/**
 * The homeowner's gallery at the size a real job produces.
 *
 * The rule these hold: newest first everywhere, and nothing is ever dropped —
 * a photograph with no date is still a photograph of somebody's house.
 */

const photo = (id: string, createdAt: string | null) => ({ id, createdAt });

test('§ newest month first, newest photograph first inside it', () => {
  // A homeowner opening this wants yesterday, not the day the skip arrived.
  const groups = groupByMonth([
    photo('aug-early', '2026-08-02T09:00:00.000Z'),
    photo('sep-late', '2026-09-28T17:00:00.000Z'),
    photo('sep-early', '2026-09-03T08:00:00.000Z'),
    photo('oct', '2026-10-01T10:00:00.000Z'),
  ]);

  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-10', '2026-09', '2026-08'],
  );
  assert.deepEqual(
    groups[1]?.items.map((p) => p.id),
    ['sep-late', 'sep-early'],
  );
});

test('§ an undated photograph is kept, and goes last', () => {
  // Dropping it loses somebody's record of their house; sorting it by a
  // missing date buries it under every month that ever existed.
  const groups = groupByMonth([
    photo('none', null),
    photo('sep', '2026-09-03T08:00:00.000Z'),
    photo('broken', 'whenever'),
  ]);

  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-09', 'unknown'],
  );
  assert.deepEqual(
    groups[1]?.items.map((p) => p.id).sort(),
    ['broken', 'none'],
  );
  assert.equal(groups[1]?.label, 'Undated');
});

test('months are labelled the way a person says them', () => {
  const [group] = groupByMonth([photo('a', '2026-09-15T12:00:00.000Z')]);
  assert.match(group?.label ?? '', /September/);
  assert.match(group?.label ?? '', /2026/);
});

test('a month boundary lands in the right month, read as UTC', () => {
  // Stored timestamps are UTC. Reading them in the server's local zone would
  // put the first of the month in the previous one for half the world.
  const groups = groupByMonth([
    photo('first', '2026-09-01T00:30:00.000Z'),
    photo('last', '2026-08-31T23:30:00.000Z'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-09', '2026-08'],
  );
});

test('nothing in, nothing out — and no empty month is invented', () => {
  assert.deepEqual(groupByMonth([]), []);
  // July had no photographs; it does not appear between August and September.
  const groups = groupByMonth([
    photo('a', '2026-09-01T00:00:00.000Z'),
    photo('b', '2026-06-01T00:00:00.000Z'),
  ]);
  assert.deepEqual(
    groups.map((g) => g.key),
    ['2026-09', '2026-06'],
  );
});

test('one photo is never "1 photos"', () => {
  assert.equal(photoCount(1), '1 photo');
  assert.equal(photoCount(0), '0 photos');
  assert.equal(photoCount(128), '128 photos');
});
