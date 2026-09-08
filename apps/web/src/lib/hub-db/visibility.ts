import 'server-only';

import { cache } from 'react';

import { getHubClient, type HubClient } from './client.ts';
import type { Actor } from './records.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';
import type { VisibilitySwitch } from '../data/mutations.ts';
import {
  isUuid,
  overlayFromRow,
  type VisibilityOverlay,
  type VisibilityOverlaySource,
  type VisibilityRow,
} from '../data/visibility-overlay.ts';

/**
 * `hub_visibility_settings` — the contractor's §6.1 switches, persisted.
 *
 * Read: one query per request for a set of project ids, deduped with React
 * `cache` and deliberately NOT held across requests. A contractor flips a switch
 * and opens the client preview on the very next request; a TTL here would show
 * them the old answer. The project rows themselves are cached elsewhere; this
 * overlay is always current.
 *
 * Write: an upsert keyed on `project_id`, filed under the resolved contractor
 * (`assertContractor` — the id `proposals` and the Hub's tables use, never an
 * auth profile). Only the three switches the table stores are written.
 *
 * Fails closed. If the Hub is unreachable the read returns nothing, every
 * switch stays off, and the homeowner sees nothing — the safe direction.
 */

type StoredRow = VisibilityRow & { contractor_id: string };

export class HubVisibility implements VisibilityOverlaySource {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private readonly readRows = cache(async (idsKey: string): Promise<VisibilityRow[]> => {
    if (idsKey === '') return [];
    try {
      return await this.client.select<VisibilityRow>({
        from: 'hub_visibility_settings',
        columns: ['project_id', 'client_portal_enabled', 'show_schedule', 'show_budget'],
        filters: { project_id: `in.(${idsKey})` },
        limit: 500,
      });
    } catch (error) {
      // Surfaced once in the server log, never to a screen: a screen that says
      // "nothing is shared" is the correct fail-closed answer while this is down.
      console.warn('[hub] visibility read failed; switches treated as off', error);
      return [];
    }
  });

  async visibilityFor(projectIds: readonly string[]): Promise<ReadonlyMap<string, VisibilityOverlay>> {
    // The column is uuid; fixture ids would make PostgREST reject the whole
    // query, so only real ids are asked about.
    const ids = [...new Set(projectIds.filter(isUuid))].sort();
    const rows = await this.readRows(ids.join(','));
    return new Map(rows.map((r) => [r.project_id, overlayFromRow(r)]));
  }

  async setVisibility(
    scope: TenantScope,
    projectId: string,
    switches: Record<VisibilitySwitch, boolean>,
    actor: Actor,
  ): Promise<void> {
    const contractorId = assertContractor(scope, 'visibility settings');
    // Plain record: the client's write API takes untyped rows, as editProject does.
    const row: Record<string, unknown> = {
      project_id: projectId,
      contractor_id: contractorId,
      client_portal_enabled: switches.clientPortalEnabled,
      show_schedule: switches.showScheduleToClient,
      show_budget: switches.showBudgetToClient,
      updated_at: new Date().toISOString(),
      updated_by: actor.name,
    };
    await this.client.upsert<StoredRow>({ from: 'hub_visibility_settings', rows: [row] }, 'project_id');
  }
}

export type HubVisibilityResult =
  | { available: true; visibility: HubVisibility }
  | { available: false; missing: string[] };

export function getHubVisibility(): HubVisibilityResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, visibility: new HubVisibility(hub.client) };
}

/** The overlay source for the data layer, or undefined when the Hub is not configured. */
export function hubVisibilitySource(): VisibilityOverlaySource | undefined {
  const result = getHubVisibility();
  return result.available ? result.visibility : undefined;
}
