import type {
  DraftInvoice,
  InvoiceRail,
  InvoiceRailResult,
  InvoiceRecipient,
} from './invoice.ts';
import { readyToSend } from './invoice.ts';

/**
 * The GoHighLevel invoice rail.
 *
 * Confirmed rail (Chris, 2026-09-05): GHL invoicing, not Stripe. Built against
 * the real API shape read from the live location on the same day, not a guess —
 * ad-hoc line items (name + amount + qty, no product needed), amounts in whole
 * dollars, USD, business details filled from location settings.
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING THIS RAIL WILL NOT DO
 *
 * It creates a DRAFT and stops. `POST /invoices/` on GHL creates a draft;
 * sending is a separate `POST /invoices/{id}/send` that this file does not call
 * and does not implement. That is the guardrail made structural: a person
 * reviews the draft in GHL and sends it, exactly Chris's flow, and no bug here
 * can put an invoice in front of a homeowner on its own.
 *
 * A live create is still a write to a production system, so the route that
 * calls this confirms first — this module is the client, not the trigger.
 * ---------------------------------------------------------------------------
 */

export interface GhlRailConfig {
  readonly token: string;
  readonly locationId: string;
  readonly apiBase?: string;
  readonly apiVersion?: string;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** The contractor's business name, shown on the invoice. */
  readonly businessName?: string;
  /** Days until due, from the issue date. */
  readonly dueInDays?: number;
}

const DEFAULT_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_VERSION = '2021-07-28';

/** A GHL invoice line item, ad-hoc (no product/price id needed). */
interface GhlInvoiceItem {
  name: string;
  description: string;
  currency: 'USD';
  amount: number;
  qty: number;
  taxInclusive: boolean;
}

export interface GhlInvoicePayload {
  altId: string;
  altType: 'location';
  name: string;
  title: 'INVOICE';
  currency: 'USD';
  businessDetails: { name: string };
  discount: { type: 'percentage'; value: number };
  contactDetails: { id: string; name: string; email: string; phoneNo?: string };
  invoiceItems: GhlInvoiceItem[];
  issueDate: string;
  dueDate: string;
  termsNotes: string;
  liveMode: boolean;
  automaticTaxesEnabled: boolean;
  sentTo: { email: string[]; emailCc: []; emailBcc: []; phoneNo: string[] };
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Map a composed draft onto GHL's create-invoice body.
 *
 * Pure and exported so the mapping is tested without touching the network.
 * The amount is asserted by the caller, not here: an item with a null amount is
 * not a shape this should ever be asked to build (see `createDraft`).
 */
export function buildGhlInvoicePayload(
  invoice: DraftInvoice,
  recipient: InvoiceRecipient,
  opts: { locationId: string; businessName: string; issue: Date; dueInDays: number },
): GhlInvoicePayload {
  const due = new Date(opts.issue);
  due.setDate(due.getDate() + opts.dueInDays);

  return {
    altId: opts.locationId,
    altType: 'location',
    // The reference carries the project code, so the invoice name ties back to
    // the one project id Chris wanted on everything a client receives.
    name: invoice.reference,
    title: 'INVOICE',
    currency: 'USD',
    businessDetails: { name: opts.businessName },
    discount: { type: 'percentage', value: 0 },
    contactDetails: {
      id: recipient.ghlContactId,
      name: recipient.name,
      email: recipient.email,
      ...(recipient.phone ? { phoneNo: recipient.phone } : {}),
    },
    invoiceItems: [
      {
        name: invoice.milestone,
        description: invoice.terms,
        currency: 'USD',
        amount: invoice.amount ?? 0,
        qty: 1,
        taxInclusive: true,
      },
    ],
    issueDate: dateOnly(opts.issue),
    dueDate: dateOnly(due),
    termsNotes: invoice.terms,
    liveMode: true,
    automaticTaxesEnabled: false,
    sentTo: {
      email: [recipient.email],
      emailCc: [],
      emailBcc: [],
      phoneNo: recipient.phone ? [recipient.phone] : [],
    },
  };
}

/**
 * Build a GHL invoice rail.
 *
 * `createDraft` refuses before it ever calls GHL when the draft is not ready:
 * no amount, or no real project code. Better to refuse locally than to create a
 * malformed draft in a live account that someone then has to find and delete.
 */
export function createGhlInvoiceRail(config: GhlRailConfig): InvoiceRail {
  const base = (config.apiBase ?? DEFAULT_BASE).replace(/\/+$/, '');
  const version = config.apiVersion ?? DEFAULT_VERSION;
  const doFetch = config.fetchImpl ?? fetch;
  const businessName = config.businessName ?? 'Alliance For Contractors';
  const dueInDays = config.dueInDays ?? 5;

  return {
    name: 'ghl',
    async createDraft(invoice: DraftInvoice, recipient: InvoiceRecipient): Promise<InvoiceRailResult> {
      if (invoice.needsAmount) {
        return { created: false, reason: 'the invoice has no amount yet — the contractor sets it before this' };
      }
      if (!readyToSend(invoice)) {
        return { created: false, reason: 'the project has no code yet, so the invoice cannot be tied to it' };
      }
      if (recipient.ghlContactId.trim() === '' || recipient.email.trim() === '') {
        return { created: false, reason: 'the recipient is missing a GHL contact id or email' };
      }

      const payload = buildGhlInvoicePayload(invoice, recipient, {
        locationId: config.locationId,
        businessName,
        issue: new Date(),
        dueInDays,
      });

      let response: Response;
      try {
        response = await doFetch(`${base}/invoices/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.token}`,
            Version: version,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        return { created: false, reason: `could not reach GHL: ${error instanceof Error ? error.message : 'unknown'}` };
      }

      const text = await response.text();
      if (!response.ok) {
        // Summarised, not echoed wholesale, so a token in a header cannot travel
        // through an error into a log.
        return { created: false, reason: `GHL refused the draft (HTTP ${response.status})` };
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return { created: false, reason: 'GHL returned a non-JSON response to a created draft' };
      }

      const id = extractInvoiceId(body);
      if (id === null) {
        return { created: false, reason: 'GHL created something but returned no invoice id' };
      }

      return {
        created: true,
        rail: 'ghl',
        externalId: id,
        editUrl: `https://app.gohighlevel.com/location/${config.locationId}/invoices/${id}`,
      };
    },
  };
}

function extractInvoiceId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  for (const key of ['_id', 'id', 'invoiceId']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  // Some GHL creates nest the record under `invoice`.
  const nested = obj.invoice;
  if (nested !== undefined) return extractInvoiceId(nested);
  return null;
}
