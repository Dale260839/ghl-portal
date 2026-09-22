import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { columnSupport } from './column-support.ts';

/**
 * A sub-account's GoHighLevel Marketplace install — one row per location.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TABLE TAKES NO TENANT SCOPE
 *
 * Every other module in this folder demands a `TenantScope` and refuses without
 * one, because every other table holds one contractor's *data*. This one holds
 * the *connection* — the credential the server uses to talk to GoHighLevel on
 * that sub-account's behalf. It is keyed by the location id, which is itself
 * the tenant boundary: a caller asking for location X can only ever be handed
 * location X's row.
 *
 * Nothing here is ever returned to a page, a component, or a response body.
 * The only consumers are `ghl/oauth-tokens.ts` and the install callback.
 *
 * WHY IT IS SAFE BEFORE THE MIGRATION IS RUN
 *
 * Migrations are run by hand and code deploys on push, so the app is routinely
 * ahead of the database. Every read below probes for the table first (one
 * `limit=0` request per process). Without the table the answer is "not
 * installed", which sends every caller down the Private Integration token path
 * that runs today. A missing migration is never an outage.
 * ---------------------------------------------------------------------------
 */

const TABLE = 'hub_ghl_oauth';

export interface LocationInstall {
  locationId: string;
  companyId: string | null;
  clientId: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: string | null;
  scopes: string | null;
  claimId: string | null;
  claimedAt: string | null;
}

interface InstallRow {
  location_id: string;
  company_id: string | null;
  client_id: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  scopes: string | null;
  claim_id: string | null;
  claimed_at: string | null;
}

function toInstall(row: InstallRow): LocationInstall {
  return {
    locationId: row.location_id,
    companyId: row.company_id,
    clientId: row.client_id,
    refreshToken: row.refresh_token,
    accessToken: row.access_token,
    accessExpiresAt: row.access_expires_at,
    scopes: row.scopes,
    claimId: row.claim_id,
    claimedAt: row.claimed_at,
  };
}

export class HubGhlOauth {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  /** Whether migration 0016 has been run on this deployment's database. */
  private available(): Promise<boolean> {
    return columnSupport(this.client, TABLE, ['location_id']);
  }

  /**
   * One sub-account's install, if it has one.
   *
   * Filtered on the client id as well as the location: a row left by a previous
   * Marketplace app holds a refresh token the current app's secret cannot
   * redeem, and trying would produce a confusing 401 rather than an obvious
   * "not installed".
   */
  async read(clientId: string, locationId: string): Promise<LocationInstall | null> {
    if (locationId.trim() === '') return null;
    if (!(await this.available())) return null;

    const rows = await this.client.select<InstallRow>({
      from: TABLE,
      filters: { location_id: `eq.${locationId}`, client_id: `eq.${clientId}` },
      limit: 1,
    });
    const row = rows[0];
    return row === undefined ? null : toInstall(row);
  }

  /** Which sub-accounts are connected. For the install page, never for access. */
  async connectedLocations(clientId: string): Promise<string[]> {
    if (!(await this.available())) return [];
    const rows = await this.client.select<{ location_id: string }>({
      from: TABLE,
      columns: ['location_id'],
      filters: { client_id: `eq.${clientId}` },
      limit: 500,
    });
    return rows.map((r) => r.location_id);
  }

  /**
   * Records an install, replacing any previous one for the same sub-account.
   *
   * Re-installing is a normal thing to do — after a scope change, or when a
   * refresh token has been lost — so this overwrites rather than refusing.
   */
  async save(install: {
    locationId: string;
    companyId: string | null;
    clientId: string;
    refreshToken: string;
    accessToken: string | null;
    accessExpiresAt: string | null;
    scopes: string | null;
    installedBy: string | null;
  }): Promise<boolean> {
    if (!(await this.available())) return false;
    await this.client.upsert(
      {
        from: TABLE,
        rows: [
          {
            location_id: install.locationId,
            company_id: install.companyId,
            client_id: install.clientId,
            refresh_token: install.refreshToken,
            access_token: install.accessToken,
            access_expires_at: install.accessExpiresAt,
            scopes: install.scopes,
            claim_id: null,
            claimed_at: null,
            updated_at: new Date().toISOString(),
            installed_by: install.installedBy,
          },
        ],
      },
      'location_id',
    );
    return true;
  }

  /**
   * Take the refresh claim for one sub-account, or find that someone else
   * holds it.
   *
   * GoHighLevel invalidates the old refresh token the moment a new one is
   * issued, so two instances refreshing the same row together would leave one
   * holding a dead token — and with it, that contractor's API access. This is
   * the same durable single-winner pattern as the invoice claim (0014): the
   * update itself is the lock, because only one PATCH can match a row whose
   * claim is free.
   *
   * Unlike the invoice claim, this one EXPIRES. A refresh that never completes
   * must not lock a contractor out for ever; a repeated refresh costs one
   * wasted token, where a repeated invoice would cost a homeowner a second bill.
   */
  async claim(
    clientId: string,
    locationId: string,
    claimId: string,
    staleAfterMs: number,
  ): Promise<boolean> {
    if (!(await this.available())) return false;
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const updated = await this.client.update<InstallRow>({
      from: TABLE,
      filters: {
        location_id: `eq.${locationId}`,
        client_id: `eq.${clientId}`,
        or: `(claim_id.is.null,claimed_at.lt.${cutoff})`,
      },
      patch: { claim_id: claimId, claimed_at: new Date().toISOString() },
    });
    return updated.length > 0;
  }

  /**
   * Store what the refresh returned, and release the claim.
   *
   * Filtered on the claim we hold: if it expired and another instance took over
   * in the meantime, this writes nothing rather than overwriting their newer
   * token with our older one.
   */
  async saveRefreshed(
    clientId: string,
    locationId: string,
    claimId: string,
    tokens: { refreshToken: string; accessToken: string; accessExpiresAt: string },
  ): Promise<boolean> {
    if (!(await this.available())) return false;
    const updated = await this.client.update<InstallRow>({
      from: TABLE,
      filters: {
        location_id: `eq.${locationId}`,
        client_id: `eq.${clientId}`,
        claim_id: `eq.${claimId}`,
      },
      patch: {
        refresh_token: tokens.refreshToken,
        access_token: tokens.accessToken,
        access_expires_at: tokens.accessExpiresAt,
        claim_id: null,
        claimed_at: null,
        updated_at: new Date().toISOString(),
      },
    });
    return updated.length > 0;
  }

  /** Give the claim back without changing anything — a refresh that failed. */
  async releaseClaim(clientId: string, locationId: string, claimId: string): Promise<void> {
    if (!(await this.available())) return;
    await this.client.update({
      from: TABLE,
      filters: {
        location_id: `eq.${locationId}`,
        client_id: `eq.${clientId}`,
        claim_id: `eq.${claimId}`,
      },
      patch: { claim_id: null, claimed_at: null },
    });
  }
}

export type HubGhlOauthResult =
  | { available: true; store: HubGhlOauth }
  | { available: false; missing: string[] };

export function getHubGhlOauth(): HubGhlOauthResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, store: new HubGhlOauth(hub.client) };
}
