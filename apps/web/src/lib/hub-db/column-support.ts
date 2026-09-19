import 'server-only';

import type { HubClient } from './client.ts';

/**
 * Does this deployment's database have these columns yet?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Migrations are run by hand, by the owner, and code reaches production the
 * moment it is pushed. So there is always a window where the deployed app is
 * ahead of the database. Writing a column that does not exist yet fails the
 * whole statement (PostgREST `PGRST204`), which would mean a crew member's
 * photo is lost because a migration has not been run — the wrong way round.
 *
 * So the app ASKS, once per process per table, and degrades: with the column it
 * writes the link, without it writes what it wrote yesterday. When the
 * migration lands, the next process picks it up. One `limit=0` read per table
 * per process is the whole cost.
 *
 * It is never used to decide whether something is ALLOWED — only whether a
 * column can be written. Permission questions are answered elsewhere.
 * ---------------------------------------------------------------------------
 */

const cache = new Map<string, Promise<boolean>>();

export function columnSupport(
  client: HubClient,
  table: string,
  columns: readonly string[],
): Promise<boolean> {
  const key = `${table}:${[...columns].sort().join(',')}`;
  const known = cache.get(key);
  if (known !== undefined) return known;

  const probe = client
    .select({ from: table, columns, limit: 0 })
    .then(() => true)
    .catch(() => {
      console.warn(`[hub] ${table} has no ${columns.join(', ')} yet — run the migration`);
      return false;
    });

  cache.set(key, probe);
  return probe;
}

/** For tests: forget what was probed. */
export function resetColumnSupport(): void {
  cache.clear();
}
