import 'server-only';

import { readGhlConfig } from '../ghl/config.ts';
import { createGhlInvoiceRail } from './ghl-rail.ts';
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
export function resolveInvoiceRail(env: NodeJS.ProcessEnv = process.env): InvoiceRail {
  const config = readGhlConfig(env);
  if (!config.configured) return unconfiguredRail;
  if (config.config.locationId.trim() === '') return unconfiguredRail;

  return createGhlInvoiceRail({
    token: config.config.token,
    locationId: config.config.locationId,
    apiBase: config.config.baseUrl,
    apiVersion: config.config.apiVersion,
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
