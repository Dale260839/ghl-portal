import type { ClientMilestoneView, ClientUpdateView } from './client-projection.ts';

export function portalCalendarDay(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return null;
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

/** Inputs must already have passed the homeowner visibility projection. */
export function portalDashboardDates(
  updates: readonly ClientUpdateView[], milestones: readonly ClientMilestoneView[],
  today: string = new Date().toISOString().slice(0, 10),
) {
  const publishedDates = updates.map(u => portalCalendarDay(u.publishDate) ?? portalCalendarDay(u.updateDate))
    .filter((date): date is string => date !== null && date <= today).sort();
  const upcoming = milestones.filter(m => {
    const end = portalCalendarDay(m.plannedEnd) ?? portalCalendarDay(m.plannedStart);
    return m.status !== 'Completed' && (end === null || end >= today);
  }).slice().sort((a, b) =>
    (portalCalendarDay(a.plannedStart) ?? '9999-12-31').localeCompare(portalCalendarDay(b.plannedStart) ?? '9999-12-31') ||
    a.id.localeCompare(b.id));
  return { latestPublishedDate: publishedDates.at(-1) ?? null, upcoming };
}
