import type { ScheduleItem } from './hub-db/schedule.ts';

/**
 * The schedule, as a crew member sees it (Dale, 2026-09-24).
 *
 * *"Contractor can send schedule and tag it to their crew field or homeowner,
 * but crew field don't have a choice to see it in their view."*
 *
 * ---------------------------------------------------------------------------
 * WHAT DECIDES WHAT THEY SEE, AND WHAT MERELY DECORATES IT
 *
 * **Access is by project.** A crew member sees the appointments on the projects
 * they are assigned to, resolved by id through `fieldProjectsFor` exactly like
 * every other field screen. That rule is robust: it is keyed on memberships and
 * task assignments, never on a name.
 *
 * **"Yours" is by label, and is only a badge.** `hub_schedule_items.trade` holds
 * a readable label — the crew member's name, or their email when they have no
 * name set (see `schedule-assignees.ts`). Matching that against the signed-in
 * person is string comparison, which §3.6 rightly forbids for anything that
 * decides access. Here it decides only whether a row is highlighted, so being
 * wrong costs a missing highlight, never a hidden or leaked appointment.
 *
 * Getting that the wrong way round would be the bug: filtering the LIST by name
 * would mean a crew member with a renamed profile silently loses the schedule
 * of a job they are standing on.
 * ---------------------------------------------------------------------------
 */

export interface FieldAppointment extends ScheduleItem {
  /** Tagged to this crew member — a highlight, never a filter. */
  mine: boolean;
  /** Sorts and groups: undated appointments are neither past nor upcoming. */
  when: number | null;
}

export interface CrewIdentity {
  name: string;
  email: string;
}

const CANCELLED = 'Cancelled';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Whether an appointment is tagged to this person.
 *
 * Deliberately narrow: an exact match on the whole label, after trimming and
 * lowercasing. Anything looser — a substring, a first name — would tag "Dan" to
 * "Dana Johnson", and a crew member seeing another person's appointment
 * highlighted as theirs is worse than no highlight at all.
 *
 * A blank identity never matches, so a session with no name does not inherit
 * every untagged appointment.
 */
export function taggedTo(trade: string, who: CrewIdentity): boolean {
  const label = normalize(trade);
  if (label === '') return false;
  const name = normalize(who.name);
  const email = normalize(who.email);
  return (name !== '' && label === name) || (email !== '' && label === email);
}

/**
 * Every appointment on the projects this crew member is assigned to.
 *
 * Cancelled ones are dropped: a crew member arriving at a job does not need a
 * list of things that are not happening, and the contractor's own screen keeps
 * the record.
 */
export function appointmentsForField(
  items: readonly ScheduleItem[],
  assignedProjectIds: ReadonlySet<string>,
  who: CrewIdentity,
): FieldAppointment[] {
  return items
    .filter((item) => assignedProjectIds.has(item.projectId) && item.status !== CANCELLED)
    .map((item) => {
      const parsed = item.startsAt === null ? NaN : Date.parse(item.startsAt);
      return {
        ...item,
        mine: taggedTo(item.trade, who),
        when: Number.isNaN(parsed) ? null : parsed,
      };
    });
}

/**
 * Split into what is still to come and what has been.
 *
 * Undated appointments count as upcoming, at the end. A date nobody has set yet
 * is a job still to do, and burying it under "past" is how it gets forgotten.
 */
export function splitByTime(
  appointments: readonly FieldAppointment[],
  now: number = Date.now(),
): { upcoming: FieldAppointment[]; past: FieldAppointment[] } {
  const upcoming: FieldAppointment[] = [];
  const past: FieldAppointment[] = [];

  for (const a of appointments) {
    if (a.when === null || a.when >= now) upcoming.push(a);
    else past.push(a);
  }

  // Soonest first for what is coming; most recent first for what has gone.
  upcoming.sort((a, b) => (a.when ?? Number.MAX_SAFE_INTEGER) - (b.when ?? Number.MAX_SAFE_INTEGER));
  past.sort((a, b) => (b.when ?? 0) - (a.when ?? 0));

  return { upcoming, past };
}

/** A whole day, for "is this today" without pulling in a date library. */
export function isSameDay(a: number, b: number): boolean {
  const one = new Date(a);
  const two = new Date(b);
  return (
    one.getFullYear() === two.getFullYear() &&
    one.getMonth() === two.getMonth() &&
    one.getDate() === two.getDate()
  );
}
