import { readGhlConfig, type GhlConfig } from './config.ts';

/**
 * Invoices, read from GoHighLevel.
 *
 * Chris settled the rail on 2026-09-01: GoHighLevel rather than Stripe. Probing
 * the live account is what decided it — invoicing is already set up and in use
 * there (8 invoices, `liveMode: true`, real templates), and the Projects custom
 * object already carries `amount_invoiced`, `amount_paid` and
 * `remaining_balance`, which only make sense if invoicing flows into it.
 *
 * His actual worry was whether a workflow could fire an invoice. It can, but not
 * for the reason he expected: we do not need GoHighLevel's workflow builder to
 * have an invoice action, because our own workflow engine calls this API at the
 * point it decides one is due. Same shape as every other effect we run.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE READS. IT DOES NOT CREATE INVOICES.
 *
 * Creation is a `POST` against a live account with real customers on it, and
 * getting it wrong bills somebody. It belongs behind a workflow effect with its
 * own review, not in a reader that a screen can call.
 * ---------------------------------------------------------------------------
 */

/** What the contractor sees. The full record, minus GHL's plumbing. */
export interface Invoice {
  id: string;
  invoiceNumber: string;
  /** `draft` · `sent` · `paid` · and whatever else GHL adds. Treated as open. */
  status: string;
  title: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  issueDate: string | null;
  dueDate: string | null;
  /** The GHL contact this was billed to — the join back to a project. */
  contactId: string | null;
  contactName: string;
  items: { name: string; quantity: number; amount: number }[];
}

/**
 * What a homeowner sees.
 *
 * **Fields are dropped by construction, not zeroed.** A client response does not
 * contain `contactId: null` or `businessDetails: {}` — it has no such property
 * at all, so a future screen cannot render one by accident and a serialised
 * payload cannot leak one. Same discipline as the §9.3 projections elsewhere.
 *
 * What is deliberately absent, and why: GHL's `businessDetails` (the
 * contractor's own bank and tax details), `syncDetails` and `externalTransactions`
 * (payment-processor internals), `sentBy` / `updatedBy` (staff identities),
 * `lateFeesConfiguration` (a policy, not a fact about this invoice), and
 * `opportunityDetails` (the sales record behind the job).
 */
export interface ClientInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  title: string;
  currency: string;
  total: number;
  amountPaid: number;
  amountDue: number;
  issueDate: string | null;
  dueDate: string | null;
  items: { name: string; quantity: number; amount: number }[];
}

interface GhlInvoiceRow {
  _id: string;
  invoiceNumber?: string;
  status?: string;
  title?: string;
  name?: string;
  currency?: string;
  total?: number;
  invoiceTotal?: number;
  amountPaid?: number;
  amountDue?: number;
  issueDate?: string;
  dueDate?: string;
  contactDetails?: { id?: string; name?: string; email?: string };
  invoiceItems?: { name?: string; qty?: number; quantity?: number; amount?: number; price?: number }[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function normalizeInvoice(row: GhlInvoiceRow): Invoice {
  const total = num(row.total ?? row.invoiceTotal);
  const paid = num(row.amountPaid);

  return {
    id: row._id,
    invoiceNumber: str(row.invoiceNumber),
    status: str(row.status) || 'unknown',
    title: str(row.title) || str(row.name),
    currency: str(row.currency) || 'USD',
    total,
    amountPaid: paid,
    // GHL sends `amountDue`, but not on every row. Derived when absent rather
    // than defaulted to zero, because a missing balance shown as nothing owed
    // is the wrong way for this number to be wrong.
    amountDue: typeof row.amountDue === 'number' ? row.amountDue : Math.max(0, total - paid),
    issueDate: row.issueDate ?? null,
    dueDate: row.dueDate ?? null,
    contactId: row.contactDetails?.id ?? null,
    contactName: str(row.contactDetails?.name),
    items: (row.invoiceItems ?? []).map((i) => ({
      name: str(i.name),
      quantity: num(i.qty ?? i.quantity) || 1,
      amount: num(i.amount ?? i.price),
    })),
  };
}

/**
 * Strip an invoice for a homeowner.
 *
 * Destructured rather than picked, so adding a field to `Invoice` does not
 * silently add it here: the compiler forces a decision about whether a client
 * may see it.
 */
export function forClient(invoice: Invoice): ClientInvoice {
  const { contactId: _contactId, contactName: _contactName, ...safe } = invoice;
  return safe;
}

/**
 * Only invoices a homeowner should be shown at all.
 *
 * A draft is the contractor still deciding. Sending a homeowner a number that
 * has not been issued is how a conversation starts about a price nobody meant
 * to quote.
 */
export function isIssued(invoice: Invoice): boolean {
  return invoice.status !== 'draft' && invoice.status !== 'void';
}

export interface InvoiceTotals {
  invoiced: number;
  paid: number;
  outstanding: number;
  overdue: number;
  currency: string;
}

export function totalInvoices(invoices: Invoice[], today = new Date()): InvoiceTotals {
  const issued = invoices.filter(isIssued);
  const iso = today.toISOString().slice(0, 10);

  return {
    invoiced: issued.reduce((s, i) => s + i.total, 0),
    paid: issued.reduce((s, i) => s + i.amountPaid, 0),
    outstanding: issued.reduce((s, i) => s + i.amountDue, 0),
    // Past its due date and still owed. Counted separately because "outstanding"
    // and "late" are different conversations to have with a client.
    overdue: issued
      .filter((i) => i.amountDue > 0 && i.dueDate !== null && i.dueDate.slice(0, 10) < iso)
      .reduce((s, i) => s + i.amountDue, 0),
    currency: issued[0]?.currency ?? 'USD',
  };
}

// ── The reader ──────────────────────────────────────────────────────────────

export class GhlInvoiceError extends Error {
  // Explicit fields, not parameter properties: Node strips types natively and
  // has no way to synthesise a constructor assignment (see CLAUDE.md).
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'GhlInvoiceError';
    this.status = status;
  }
}

export class GhlInvoices {
  private readonly config: GhlConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GhlConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async get(path: string): Promise<unknown> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Version: this.config.apiVersion,
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new GhlInvoiceError(`GET ${path} → ${response.status} ${body.slice(0, 200)}`, response.status);
    }
    return response.json();
  }

  /**
   * Every invoice on the sub-account.
   *
   * `offset` is required by GHL and must be a string — omitting it returns a
   * 422 that reads like a permissions problem, which cost half an hour once.
   */
  async list(limit = 100): Promise<Invoice[]> {
    const params = new URLSearchParams({
      altId: this.config.locationId,
      altType: 'location',
      limit: String(limit),
      offset: '0',
    });
    const body = (await this.get(`/invoices/?${params}`)) as { invoices?: GhlInvoiceRow[] };
    return (body.invoices ?? []).map(normalizeInvoice);
  }

  /**
   * Invoices billed to one contact.
   *
   * The join to a project runs through the contact, because a GHL invoice
   * carries no project reference: `projects.ghl_contact_id` → this. Filtered
   * client-side because the invoice list endpoint has no contact filter.
   */
  async forContact(contactId: string, limit = 100): Promise<Invoice[]> {
    if (contactId.trim() === '') return [];
    const all = await this.list(limit);
    return all.filter((i) => i.contactId === contactId);
  }
}

export type InvoicesResult =
  | { available: true; invoices: GhlInvoices }
  | { available: false; missing: string[] };

export function getInvoices(): InvoicesResult {
  const result = readGhlConfig();
  if (!result.configured) return { available: false, missing: result.missing };
  if (result.config.locationId.trim() === '') {
    return { available: false, missing: ['GHL_LOCATION_ID'] };
  }
  return { available: true, invoices: new GhlInvoices(result.config) };
}
