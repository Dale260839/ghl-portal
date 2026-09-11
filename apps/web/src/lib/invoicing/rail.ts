import 'server-only';

import { readGhlConfig, withLocation } from '../ghl/config.ts';
import { createGhlInvoiceRail, type InvoiceBusinessDetails } from './ghl-rail.ts';
import { unconfiguredRail, type DraftInvoice, type InvoiceRail } from './invoice.ts';
import type { StoredInvoiceDraft } from '../hub-db/invoice-drafts.ts';
import type { Project } from '../data/types.ts';

/**
 * Which rail an invoice goes out on, decided in one place.
 *
 * The rail decision was GoHighLevel (Chris, 2026-09-01). If the credentials are
 * absent this returns `unconfiguredRail`, which REFUSES rather than pretending
 * to succeed — a composed invoice that silently reaches nobody is worse than
 * one that fails loudly, because a contractor would believe a homeowner had
 * been invoiced.
 *
 * There is deliberately no environment switch between rails here. A second rail
 * is a decision, not a configuration, and adding the seam before the decision
 * would invite someone to flip it by accident.
 */
export function resolveInvoiceRail(
  env: NodeJS.ProcessEnv = process.env,
  /**
   * The contractor's own details for the top of the invoice, resolved by the
   * caller. Left out when the session is not linked to a contractor record, in
   * which case the invoice carries no business block rather than a guess.
   */
  business?: InvoiceBusinessDetails,
  /**
   * The signed-in contractor's GoHighLevel sub-account. Preferred over the
   * env var, so one deployment can raise invoices for more than one
   * contractor and the pilot does not wait on a setting the session already
   * knows. Ignored when it is not a real GHL id.
   */
  sessionLocationId?: string | null,
  /**
   * From the account's invoice template (huddle 2026-09-10). Both optional:
   * absent means the rail's defaults, exactly as before templates existed.
   */
  template?: { dueInDays?: number; standingTerms?: string | null },
): InvoiceRail {
  const config = readGhlConfig(env);
  if (!config.configured) return unconfiguredRail;
  const located = withLocation(config.config, sessionLocationId);
  if (located.locationId.trim() === '') return unconfiguredRail;

  return createGhlInvoiceRail({
    token: located.token,
    locationId: located.locationId,
    apiBase: config.config.baseUrl,
    apiVersion: config.config.apiVersion,
    ...(business !== undefined ? { business } : {}),
    ...(template?.dueInDays !== undefined ? { dueInDays: template.dueInDays } : {}),
    ...(template?.standingTerms ? { standingTerms: template.standingTerms } : {}),
  });
}

/**
 * A stored draft, as the rail needs it.
 *
 * Everything a homeowner will read comes from the DRAFT, not from the parsed
 * schedule — the contractor's edits are the authority by the time this runs.
 * The project supplies only its own identity.
 *
 * `amount` is asserted non-null by the caller; this throws rather than
 * defaulting, because the one thing that must never reach an invoice is a
 * figure nobody chose.
 */
export function draftFromStored(draft: StoredInvoiceDraft, project: Project): DraftInvoice {
  if (draft.amount === null) {
    throw new TypeError('refusing to build an invoice with no amount');
  }

  const milestone = draft.title ?? '';
  const description = draft.description ?? '';

  return {
    reference:
      project.projectCode === null
        ? `Invoice ${draft.lineOrder}`
        : `${project.projectCode} · Invoice ${draft.lineOrder}`,
    projectCode: project.projectCode,
    position: draft.lineOrder,
    // The count is not stored per line, and guessing it would put "1 of 1" on
    // an invoice that is one of four. Omitted from the reference above instead.
    totalCount: draft.lineOrder,
    milestone,
    description:
      milestone === '' ? description : description === '' ? milestone : `${milestone} — ${description}`,
    terms: description,
    amount: draft.amount,
    percentage: draft.sourcePercent,
    clientName: project.clientName,
    needsAmount: false,
    isDeposit: draft.lineOrder === 1,
    status: 'draft',
  };
}
