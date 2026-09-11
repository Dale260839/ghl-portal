import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';
import type { InvoiceTemplate } from '../invoicing/template.ts';

/**
 * `hub_invoice_templates` — one invoice template per contractor account.
 *
 * Migration 0013. The rules for what a template means live in
 * `invoicing/template.ts`; this only stores it, under the asserted contractor.
 *
 * Every read and write filters on `contractor_id` from the scope, never from a
 * caller's argument, so one contractor cannot read or overwrite another's
 * letterhead by passing a different id.
 */

interface TemplateRow {
  id: string;
  contractor_id: string;
  business_name: string | null;
  logo_url: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  standing_terms: string | null;
  due_in_days: number | null;
  updated_at: string | null;
  updated_by: string | null;
}

export interface StoredInvoiceTemplate extends InvoiceTemplate {
  updatedAt: string | null;
  updatedBy: string | null;
}

function toTemplate(row: TemplateRow): StoredInvoiceTemplate {
  return {
    businessName: row.business_name,
    logoUrl: row.logo_url,
    phone: row.phone,
    website: row.website,
    address: row.address,
    standingTerms: row.standing_terms,
    dueInDays: row.due_in_days,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export class HubInvoiceTemplates {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  /** This account's template, or null when it has never saved one. */
  async getForContractor(scope: TenantScope): Promise<StoredInvoiceTemplate | null> {
    const contractorId = assertContractor(scope, 'invoice template');
    const [row] = await this.client.select<TemplateRow>({
      from: 'hub_invoice_templates',
      filters: { contractor_id: `eq.${contractorId}` },
      limit: 1,
    });
    return row === undefined ? null : toTemplate(row);
  }

  /**
   * Save this account's template — insert or replace, one row per contractor.
   *
   * Takes an ALREADY VALIDATED template (`validateTemplateInput`). The database
   * checks the same limits, so a value that slipped past the form is refused
   * there rather than stored.
   */
  async save(
    scope: TenantScope,
    template: InvoiceTemplate,
    actor: { name: string },
  ): Promise<StoredInvoiceTemplate> {
    const contractorId = assertContractor(scope, 'save invoice template');
    const now = new Date().toISOString();

    const [row] = await this.client.upsert<TemplateRow>(
      {
        from: 'hub_invoice_templates',
        rows: [
          {
            // From the scope, never from the form.
            contractor_id: contractorId,
            business_name: template.businessName,
            logo_url: template.logoUrl,
            phone: template.phone,
            website: template.website,
            address: template.address,
            standing_terms: template.standingTerms,
            due_in_days: template.dueInDays,
            updated_at: now,
            updated_by: actor.name,
          },
        ],
      },
      'contractor_id',
    );
    if (row === undefined) throw new Error('the invoice template was not saved');
    return toTemplate(row);
  }
}

export type HubInvoiceTemplatesResult =
  | { available: true; templates: HubInvoiceTemplates }
  | { available: false; missing: string[] };

export function getHubInvoiceTemplates(): HubInvoiceTemplatesResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, templates: new HubInvoiceTemplates(hub.client) };
}
