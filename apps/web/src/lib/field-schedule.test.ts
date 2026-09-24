import { test } from 'node:test';
import assert from 'node:assert/strict';

import { appointmentsForField, splitByTime, taggedTo } from './field-schedule.ts';
import type { ScheduleItem } from './hub-db/schedule.ts';

/**
 * The crew's schedule.
 *
 * One distinction carries this whole file: what a crew member may SEE is
 * decided by project, and what is highlighted as THEIRS is decided by a label.
 * Swapping those would mean a renamed profile silently losing the schedule of a
 * job they are standing on.
 */

const item = (over: Partial<ScheduleItem> = {}): ScheduleItem => ({
  id: 'a1',
  projectId: 'p1',
  title: 'Electrical rough-in',
  startsAt: '2026-10-01T09:00:00.000Z',
  endsAt: null,
  trade: '',
  status: 'Scheduled',
  clientVisible: false,
  notes: '',
  createdAt: '2026-09-20T00:00:00.000Z',
  createdBy: null,
  ...over,
});

const DALE = { name: 'Dale Reyes', email: 'dale@alliance4contractors.com' };

// ── Access is by project ────────────────────────────────────────────────────

test('§ a crew member sees the appointments on their projects, tagged or not', () => {
  // The contractor books the whole job's schedule; a crew member standing on
  // that job needs to know what else is happening on it, not only the rows with
  // their own name against them.
  const items = [
    item({ id: 'a1', projectId: 'p1', trade: 'Dale Reyes' }),
    item({ id: 'a2', projectId: 'p1', trade: 'Someone Else' }),
    item({ id: 'a3', projectId: 'p1', trade: '' }),
  ];
  const seen = appointmentsForField(items, new Set(['p1']), DALE);
  assert.deepEqual(
    seen.map((a) => a.id),
    ['a1', 'a2', 'a3'],
  );
  assert.deepEqual(
    seen.map((a) => a.mine),
    [true, false, false],
  );
});

test('§ an appointment on a project they are NOT assigned to is never returned', () => {
  // Even when it is tagged to them by name. The project is the boundary; a
  // label is not a permission.
  const items = [item({ id: 'other', projectId: 'p9', trade: 'Dale Reyes' })];
  assert.deepEqual(appointmentsForField(items, new Set(['p1']), DALE), []);
});

test('§ a renamed crew member keeps the schedule of the job they are on', () => {
  // The failure this design exists to prevent: filter the LIST by name and a
  // profile rename empties somebody's schedule while they are standing on site.
  const items = [item({ trade: 'Their Old Name' })];
  const seen = appointmentsForField(items, new Set(['p1']), DALE);
  assert.equal(seen.length, 1, 'still visible');
  assert.equal(seen[0]?.mine, false, 'just not highlighted');
});

test('cancelled appointments are dropped', () => {
  const items = [item({ id: 'on' }), item({ id: 'off', status: 'Cancelled' })];
  assert.deepEqual(
    appointmentsForField(items, new Set(['p1']), DALE).map((a) => a.id),
    ['on'],
  );
});

// ── "Yours" is a badge, and a narrow one ───────────────────────────────────

test('§ the tag matches the whole label, never a part of it', () => {
  // "Dan" must not match "Dana Johnson". A crew member seeing someone else's
  // appointment marked as theirs is worse than no marking at all.
  assert.equal(taggedTo('Dale Reyes', DALE), true);
  assert.equal(taggedTo('  dale reyes  ', DALE), true, 'trimmed and case-insensitive');
  assert.equal(taggedTo('dale@alliance4contractors.com', DALE), true, 'by email when unnamed');
  assert.equal(taggedTo('Dale', DALE), false);
  assert.equal(taggedTo('Dale Reyes and crew', DALE), false);
  assert.equal(taggedTo('Homeowner — Dana Johnson', DALE), false);
});

test('§ a session with no name inherits nothing', () => {
  // A blank identity matching a blank label would tag every untagged
  // appointment in the project to whoever happens to have no name set.
  const nameless = { name: '', email: '' };
  assert.equal(taggedTo('', nameless), false);
  assert.equal(taggedTo('Someone', nameless), false);
  assert.equal(taggedTo('', DALE), false);
});

// ── Order, and the undated ─────────────────────────────────────────────────

test('§ an undated appointment counts as upcoming, at the end', () => {
  // A date nobody has set yet is a job still to do. Filing it under "past" is
  // how it gets forgotten.
  const now = Date.parse('2026-10-05T00:00:00.000Z');
  const items = [
    item({ id: 'later', startsAt: '2026-10-09T09:00:00.000Z' }),
    item({ id: 'soon', startsAt: '2026-10-06T09:00:00.000Z' }),
    item({ id: 'undated', startsAt: null }),
    item({ id: 'gone', startsAt: '2026-10-01T09:00:00.000Z' }),
  ];

  const { upcoming, past } = splitByTime(appointmentsForField(items, new Set(['p1']), DALE), now);
  assert.deepEqual(
    upcoming.map((a) => a.id),
    ['soon', 'later', 'undated'],
  );
  assert.deepEqual(
    past.map((a) => a.id),
    ['gone'],
  );
});

test('an unparseable date is treated as undated rather than as 1970', () => {
  const seen = appointmentsForField([item({ startsAt: 'whenever' })], new Set(['p1']), DALE);
  assert.equal(seen[0]?.when, null);
});
