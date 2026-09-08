import type { ScheduleLine } from '../payment-schedule.ts';

/**
 * Composing invoices from a payment schedule.
 *
 * This is Chris's rule from 2 Sep, made concrete: the FIRST line of a project's
 * payment schedule becomes the first invoice, and each later line becomes its
 * own invoice as the job reaches that milestone. A person always reviews and
 * sends, so nothing here is ever "sent" — every draft comes out as a draft, and
 * the send is a separate, human step (`InvoiceRail`).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS RAIL-AGNOSTIC
 *
 * The rail decision is GoHighLevel invoicing first, with Stripe kept as a later
 * option. So composition is deliberately separated from delivery: everything
 * here produces a plain `DraftInvoice` that knows nothing about GHL or Stripe.
 * Choosing or switching the rail changes only which `InvoiceRail` sends the
 * draft, never how the draft is built.
 *
 * Two of Chris's smaller rules live here too. The project code is stamped on the
 * invoice, because he wants everything a client receives tied to one reference.
 * And a blank amount is NOT invented or blocked: it is surfaced as
 * `needsAmount`, because the contractor reviews every draft before sending and
 * the empty figure is theirs to fill (a schedule can arrive without amounts).
 * ---------------------------------------------------------------------------
 */

/** Money is a number of dollars throughout the codebase; invoices follow suit. */
export interface DraftInvoice {
  /** Human reference, e.g. "BSA-044 · Invoice 1 of 4". Carries the project code. */
  readonly reference: string;
  /** The project's identity code, stamped on every invoice. `null` when pending. */
  readonly projectCode: string | null;
  /** 1-based position in the schedule. Line 1 is the deposit. */
  readonly position: number;
  readonly totalCount: number;
  /** The milestone this invoice bills for. */
  readonly milestone: string;
  /** The line description a contractor sees, milestone plus terms when present. */
  readonly description: string;
  /** The raw terms text on its own, for a rail that wants it as a separate field. */
  readonly terms: string;
  /** Dollar amount, or `null` when the schedule line carried none. */
  readonly amount: number | null;
  readonly percentage: number | null;
  /** The client this bills to. */
  readonly clientName: string;
  /**
   * True when the amount is missing and the contractor must supply it before
   * sending. Never blocks composition, only flags the draft.
   */
  readonly needsAmount: boolean;
  /**
   * True for the deposit, the first invoice that goes to the homeowner on award.
   * The later ones fire as their milestones are reached.
   */
  readonly isDeposit: boolean;
  /** Always 'draft'. A person reviews and sends; composition never sends. */
  readonly status: 'draft';
}

export interface InvoiceContext {
  /** `projects.project_code`, the identity code. `null` when still pending. */
  readonly projectCode: string | null;
  readonly clientName: string;
}

/** How the code appears on a draft when there is no project code yet. */
export const PENDING_REFERENCE = 'PENDING';

function referenceFor(code: string | null, position: number, total: number): string {
  const base = code ?? PENDING_REFERENCE;
  return `${base} · Invoice ${position} of ${total}`;
}

/**
 * The description a contractor sees on the draft.
 *
 * The milestone alone when the line has no terms, or "Milestone — terms" when it
 * does, so the richer schedule lines carry their own payment language onto the
 * invoice rather than losing it.
 */
export function describeLine(line: ScheduleLine): string {
  // `title` is nullable here, where the branch's type assumed a milestone
  // always existed. It does not: on every one of the four signed proposals the
  // schedule states a percent and no name. The description carries alone in
  // that case rather than rendering "null — upon acceptance…" on an invoice.
  const title = line.title ?? '';
  if (title === '') return line.description;
  return line.description === '' ? title : `${title} — ${line.description}`;
}

function draftFrom(line: ScheduleLine, total: number, ctx: InvoiceContext): DraftInvoice {
  return {
    reference: referenceFor(ctx.projectCode, line.order, total),
    projectCode: ctx.projectCode,
    position: line.order,
    totalCount: total,
    milestone: line.title ?? '',
    description: describeLine(line),
    terms: line.description,
    amount: line.amount,
    percentage: line.percent,
    clientName: ctx.clientName,
    needsAmount: line.amount === null,
    isDeposit: line.order === 1,
    status: 'draft',
  };
}

/**
 * Every invoice a schedule implies, in schedule order.
 *
 * The whole set is composed at once so the reference on each can say "1 of 4".
 * An empty schedule yields no invoices, which is the correct result, not an
 * error: there is simply nothing to bill until the schedule is filled in.
 */
export function composeInvoices(
  lines: readonly ScheduleLine[],
  ctx: InvoiceContext,
): DraftInvoice[] {
  return lines.map((line) => draftFrom(line, lines.length, ctx));
}

/**
 * Just the first invoice, the deposit that goes out on award.
 *
 * Returns `null` when the schedule is empty. The caller shows the contractor an
 * empty state to fill rather than a blank draft, matching Chris's flow.
 */
export function composeFirstInvoice(
  lines: readonly ScheduleLine[],
  ctx: InvoiceContext,
): DraftInvoice | null {
  const first = lines[0];
  if (first === undefined) return null;
  return draftFrom(first, lines.length, ctx);
}

// ── The rail seam ───────────────────────────────────────────────────────────
/**
 * Creating a draft on a rail, behind one interface.
 *
 * The rail is GoHighLevel, confirmed by Chris. The word is `createDraft`, not
 * `send`, and the distinction is the whole safety model: the Hub only ever
 * creates a DRAFT invoice. A person reviews it and sends it from GHL. There is
 * deliberately no code path in this repo that sends an invoice to a client, so
 * no bug and no future refactor can bill someone automatically.
 *
 * The recipient is passed in rather than carried on the draft, because the draft
 * is composed from BuildSuite data that never includes a GHL contact id.
 * Composition stays rail-agnostic; the rail supplies the GHL specifics.
 */
export interface InvoiceRecipient {
  /** The client's GoHighLevel contact id. The invoice attaches to this. */
  readonly ghlContactId: string;
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
}

export type InvoiceRailResult =
  | { readonly created: true; readonly rail: string; readonly externalId: string; readonly editUrl?: string }
  | { readonly created: false; readonly reason: string };

export interface InvoiceRail {
  readonly name: string;
  createDraft(invoice: DraftInvoice, recipient: InvoiceRecipient): Promise<InvoiceRailResult>;
}

/**
 * The rail before one is wired. Refuses, and says why.
 *
 * Deliberately not a no-op that reports success: a composed draft that silently
 * never reaches anyone is worse than one that fails loudly, because a contractor
 * would believe a client had been invoiced.
 */
export const unconfiguredRail: InvoiceRail = {
  name: 'unconfigured',
  async createDraft() {
    return { created: false, reason: 'no invoice rail is wired yet (GHL invoicing pending)' };
  },
};

/** A draft is only ready to send once it has an amount and a real project code. */
export function readyToSend(invoice: DraftInvoice): boolean {
  return !invoice.needsAmount && invoice.projectCode !== null;
}
