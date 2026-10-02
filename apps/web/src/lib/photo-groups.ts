/**
 * The homeowner's gallery, grouped by when the work happened
 * (Dale, 2026-10-02 — from the audit's refinements list).
 *
 * ---------------------------------------------------------------------------
 * WHY GROUPING IS NOT DECORATION HERE
 *
 * Every released photo was in one flat grid, newest first, with no dates
 * between them. That reads well at twenty photographs. **One kitchen is four
 * hundred**, and at that size a homeowner scrolling for "the week the units
 * went in" has no way to find it — the grid is a wall.
 *
 * Months are the right unit for a renovation. A job runs for weeks, people
 * remember it in months ("that was August"), and a month heading with a count
 * gives the thing a flat grid never does: a sense of how much happened and
 * when.
 *
 * NEWEST FIRST, ALWAYS. A homeowner opening this wants what happened yesterday,
 * not the day the skip arrived.
 *
 * Pure, so the ordering and the labels are tested without a browser. The
 * grouping key is derived from the date alone — nothing here reads anything a
 * homeowner may not see, and it deliberately takes only the fields the portal's
 * own projection already exposes.
 * ---------------------------------------------------------------------------
 */

export interface DatedItem {
  id: string;
  createdAt: string | null;
}

export interface PhotoGroup<T extends DatedItem> {
  /** `YYYY-MM`, or `unknown`. Stable, so it can key a list. */
  key: string;
  /** "September 2026", or "Undated". */
  label: string;
  items: T[];
}

function monthKey(iso: string | null): string {
  if (iso === null) return 'unknown';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'unknown';
  const date = new Date(parsed);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  if (key === 'unknown') return 'Undated';
  const [year, month] = key.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Newest month first, newest photograph first inside it.
 *
 * Undated photographs go last rather than being dropped or guessed at: a photo
 * whose timestamp is missing is still a photo of somebody's house, and sorting
 * it to 1970 would bury it under every month that ever existed.
 */
export function groupByMonth<T extends DatedItem>(items: readonly T[]): PhotoGroup<T>[] {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = monthKey(item.createdAt);
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [item]);
    else existing.push(item);
  }

  const dated = [...groups.entries()].filter(([key]) => key !== 'unknown');
  dated.sort(([a], [b]) => b.localeCompare(a));

  const ordered = [...dated];
  const unknown = groups.get('unknown');
  if (unknown !== undefined) ordered.push(['unknown', unknown]);

  return ordered.map(([key, group]) => ({
    key,
    label: monthLabel(key),
    items: [...group].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
  }));
}

/** "128 photos" / "1 photo". Used in the header and on every month. */
export function photoCount(n: number): string {
  return n === 1 ? '1 photo' : `${n} photos`;
}
