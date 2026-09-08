import type { Project } from './types.ts';

/**
 * The contractor's visibility switches, stored in the Hub and laid over
 * BuildSuite's projects.
 *
 * BuildSuite holds no notion of "what the homeowner may see", so every project
 * it serves arrives with every switch off — the safe default, and until 8 Sep
 * also the permanent state, because the switches were only ever flipped on the
 * in-memory fixtures. This module is the missing half: the switches live in
 * `hub_visibility_settings` (the Hub's own database) and are applied here.
 *
 * Pure. The Hub read is injected (`VisibilityOverlaySource`) so this can be
 * unit-tested and so the BuildSuite source stays free of database clients.
 *
 * Only what the table actually stores is applied: the master switch, schedule
 * and budget. `showDetailedPricing` and `showAssignedTeam` have no column, and
 * inventing one is a migration, not a mapping — they stay as the source set
 * them until that migration exists.
 */

export interface VisibilityRow {
  project_id: string;
  client_portal_enabled: boolean;
  show_schedule: boolean;
  show_budget: boolean;
}

export type VisibilityOverlay = Pick<
  Project,
  'clientPortalEnabled' | 'showScheduleToClient' | 'showBudgetToClient'
>;

export interface VisibilityOverlaySource {
  /** Overlays for the given project ids. Absent id = no row = leave as is. */
  visibilityFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, VisibilityOverlay>>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `project_id` is a uuid column; a fixture id like `BSP-2026-000184` is not one. */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}

export function overlayFromRow(row: VisibilityRow): VisibilityOverlay {
  return {
    clientPortalEnabled: row.client_portal_enabled === true,
    showScheduleToClient: row.show_schedule === true,
    showBudgetToClient: row.show_budget === true,
  };
}

/**
 * Returns new project objects with the stored switches applied. Projects with
 * no row come back untouched (same object), so a missing Hub row can never turn
 * anything on. Never mutates its inputs.
 */
export function applyVisibility(
  projects: readonly Project[],
  byId: ReadonlyMap<string, VisibilityOverlay>,
): Project[] {
  if (byId.size === 0) return [...projects];
  return projects.map((p) => {
    const overlay = byId.get(p.buildsuiteProjectId);
    return overlay === undefined ? p : { ...p, ...overlay };
  });
}
