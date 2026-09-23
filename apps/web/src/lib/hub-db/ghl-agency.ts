import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { columnSupport } from './column-support.ts';

/**
 * The agency's Marketplace install — one row, used only to prove sub-accounts
 * at sign-in.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE MOST POWERFUL ROW IN THE DATABASE
 *
 * It can read every sub-account in the agency. That is exactly what makes it
 * useful — a contractor who has installed nothing can still sign in — and
 * exactly why it never leaves this file for anything else. It is passed to one
 * call, `GET /locations/{id}`, and nothing may widen that without the same
 * argument being made again.
 *
 * It takes no tenant scope for the same reason `ghl-oauth.ts` does not: this is
 * the deployment's own connection, not a contractor's data. Nothing here is
 * returned to a page, a component, or a response body.
 *
 * Safe before the migration: every read probes for the table, and without it
 * the answer is "no agency install", which leaves sign-in exactly as it was.
 * ---------------------------------------------------------------------------
 */

const TABLE = 'hub_ghl_agency';

export interface AgencyInstall {
  companyId: string;
  clientId: string;
  refreshToken: string;
  accessToken: string | null;
  accessExpiresAt: string | null;
  scopes: string | null;
}

interface AgencyRow {
  company_id: string;
  client_id: string;
  refresh_token: string;
  access_token: string | null;
  access_expires_at: string | null;
  scopes: string | null;
}

export class HubGhlAgency {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private available(): Promise<boolean> {
    return columnSupport(this.client, TABLE, ['company_id']);
  }

  /** The install for this app, if there is one. */
  async read(clientId: string): Promise<AgencyInstall | null> {
    if (!(await this.available())) return null;
    const rows = await this.client.select<AgencyRow>({
      from: TABLE,
      filters: { client_id: `eq.${clientId}` },
      limit: 1,
    });
    const row = rows[0];
    return row === undefined
      ? null
      : {
          companyId: row.company_id,
          clientId: row.client_id,
          refreshToken: row.refresh_token,
          accessToken: row.access_token,
          accessExpiresAt: row.access_expires_at,
          scopes: row.scopes,
        };
  }

  async save(install: {
    companyId: string;
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
      'company_id',
    );
    return true;
  }

  /**
   * Take the refresh claim, or find that another instance holds it.
   *
   * Same durable single-winner pattern as 0014 and 0016: the update is the
   * lock, because only one PATCH can match a row whose claim is free. It
   * matters more here than anywhere — this token is how everybody signs in, so
   * two instances rotating it together would lock out the whole agency rather
   * than one contractor.
   */
  async claim(clientId: string, claimId: string, staleAfterMs: number): Promise<boolean> {
    if (!(await this.available())) return false;
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const updated = await this.client.update<AgencyRow>({
      from: TABLE,
      filters: {
        client_id: `eq.${clientId}`,
        or: `(claim_id.is.null,claimed_at.lt.${cutoff})`,
      },
      patch: { claim_id: claimId, claimed_at: new Date().toISOString() },
    });
    return updated.length > 0;
  }

  async saveRefreshed(
    clientId: string,
    claimId: string,
    tokens: { refreshToken: string; accessToken: string; accessExpiresAt: string },
  ): Promise<boolean> {
    if (!(await this.available())) return false;
    const updated = await this.client.update<AgencyRow>({
      from: TABLE,
      filters: { client_id: `eq.${clientId}`, claim_id: `eq.${claimId}` },
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

  async releaseClaim(clientId: string, claimId: string): Promise<void> {
    if (!(await this.available())) return;
    await this.client.update({
      from: TABLE,
      filters: { client_id: `eq.${clientId}`, claim_id: `eq.${claimId}` },
      patch: { claim_id: null, claimed_at: null },
    });
  }
}

export type HubGhlAgencyResult =
  | { available: true; store: HubGhlAgency }
  | { available: false; missing: string[] };

export function getHubGhlAgency(): HubGhlAgencyResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, store: new HubGhlAgency(hub.client) };
}
