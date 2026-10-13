import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalDashboardDates } from './portal-dashboard.ts';

const update = (id: string, updateDate: string, publishDate: string | null) =>
  ({ id, updateDate, publishDate, clientSummary: '' });
const milestone = (id: string, start: string, end: string, status = 'Planned') =>
  ({ id, milestoneName: id, plannedStart: start, plannedEnd: end, status });

test('latest homeowner date is the publication day, not the original project or work day', () => {
  const dates = portalDashboardDates([
    update('newer-work', '2026-10-10', '2026-10-11T12:00:00Z'),
    update('later-release', '2026-09-01', '2026-10-12T08:00:00Z'),
  ], [], '2026-10-13');
  assert.equal(dates.latestPublishedDate, '2026-10-12');
});

test('legacy published updates fall back to valid work dates; invalid and future days are not shown as recent', () => {
  assert.equal(portalDashboardDates([
    update('legacy', '2026-10-09', null),
    update('bad', '2026-02-31', 'not a date'),
    update('future', '2026-10-14', '2026-10-14T00:00:00Z'),
  ], [], '2026-10-13').latestPublishedDate, '2026-10-09');
  assert.equal(portalDashboardDates([], [], '2026-10-13').latestPublishedDate, null);
});

test('upcoming is sorted, includes ongoing work, and excludes completed and expired milestones', () => {
  const milestones = [milestone('later', '2026-10-20', '2026-10-21'),
    milestone('past', '2026-10-01', '2026-10-02'),
    milestone('ongoing', '2026-10-12', '2026-10-14', 'In Progress'),
    milestone('complete', '2026-10-15', '2026-10-16', 'Completed'),
    milestone('undated', '', ''), milestone('today', '2026-10-13', '2026-10-13')];
  const original = structuredClone(milestones);
  assert.deepEqual(portalDashboardDates([], milestones, '2026-10-13').upcoming.map(m => m.id),
    ['ongoing', 'today', 'later', 'undated']);
  assert.deepEqual(milestones, original);
});
