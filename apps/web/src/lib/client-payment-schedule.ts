import { balanceComputedDrafts, draftInvoiceFor, type ScheduleLine } from './payment-schedule.ts';

/**
 * The homeowner's payment schedule — what they will pay, and when.
 *
 * Chris, huddle 2026-09-10: clients should "view payment schedules and upcoming
 * amounts on the client-side project view". Until now the portal's Payments
 * screen showed only invoices already issued, so a homeowner who had signed a
 * five-stage contract saw "No invoices yet" and nothing about what was coming.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH NUMBER IS ALLOWED TO COME FROM
 *
 * A homeowner sees a figure from exactly one of two places:
 *
 *   **The contract they signed** — the amount the schedule line states, or its
 *   percent of the contract total. That is a number they agreed to.
 *
 *   **An invoice actually issued to them** — its total, once it exists in
 *   GoHighLevel and is not a draft.
 *
 * NEVER the contractor's in-progress draft amount. `hub_invoice_drafts.amount`
 * is the contractor still deciding, and the rule on the invoices below applies
 * here too: "showing a homeowner a figure nobody has issued is how an argument
 * starts about a price that was never quoted." A draft only ever contributes
 * its LINK to an issued invoice, never its number.
 *
 * ---------------------------------------------------------------------------
 * HOW A LINE KNOWS IT HAS BEEN BILLED — ids all the way, never names (§3.6)
 *
 *   schedule line `order`
 *     → `hub_invoice_drafts.line_order` (unique per proposal)
 *     → `external_id`, the GoHighLevel invoice id the rail recorded
 *     → an ISSUED invoice with that id → paid, or still due
 *
 * Any link missing, and the line reads as upcoming. Matching a line to an
 * invoice by title or amount would put "Paid" on the wrong stage the first time
 * two stages cost the same.
 *
 * The figure arithmetic is `draftInvoiceFor`'s, deliberately — the contractor's
 * review screen and the homeowner's schedule compute the same percent of the
 * same total the same way, so they cannot show two different numbers for one
 * line.
 * ---------------------------------------------------------------------------
 */

/** The only part of a stored draft this reads: which invoice it became. */
export interface DraftLink {
  lineOrder: number;
  /** The GoHighLevel invoice id, once the rail has created it. */
  externalId: string | null;
}

/** The fields of an issued invoice this needs. `ClientInvoice` satisfies it. */
export interface IssuedInvoiceRef {
  id: string;
  status: string;
  total: number;
  amountDue: number;
}

export type ClientLineState = 'paid' | 'due' | 'upcoming';

/** One line as a homeowner sees it. Built by literal — nothing else rides along. */
export interface ClientScheduleLine {
  order: number;
  /** Never blank: the contract's own name, or "Payment 2" when it gives none. */
  title: string;
  percent: number | null;
  amount: number | null;
  /** Where `amount` came from. Null when neither source can supply one. */
  basis: 'contract' | 'invoice' | null;
  description: string;
  state: ClientLineState;
}

function isPaid(invoice: IssuedInvoiceRef): boolean {
  return invoice.status === 'paid' || (invoice.total > 0 && invoice.amountDue <= 0);
}

export function clientPaymentSchedule(input: {
  lines: readonly ScheduleLine[];
  contractTotal: number | null;
  links: readonly DraftLink[];
  /** Issued invoices for THIS homeowner only. Drafts and voids must not be here. */
  invoices: readonly IssuedInvoiceRef[];
}): ClientScheduleLine[] {
  const invoiceById = new Map(input.invoices.map((i) => [i.id, i]));
  const invoiceForLine = new Map<number, IssuedInvoiceRef>();
  for (const link of input.links) {
    const id = link.externalId?.trim() ?? '';
    const invoice = id === '' ? undefined : invoiceById.get(id);
    if (invoice !== undefined && !invoiceForLine.has(link.lineOrder)) {
      invoiceForLine.set(link.lineOrder, invoice);
    }
  }

  // The contract figures for the WHOLE schedule at once, balanced so the stages
  // close to the contract total to the cent — the same figures the contractor's
  // drafts use (`draftsForProposal`).
  const sorted = [...input.lines].sort((a, b) => a.order - b.order);
  const contractFigures = balanceComputedDrafts(
    sorted.map((line) => draftInvoiceFor(line, input.contractTotal)),
    input.contractTotal,
  );

  return sorted
    .map((line, i) => {
      const invoice = invoiceForLine.get(line.order);
      const fromContract = contractFigures[i]!;

      let amount: number | null;
      let basis: ClientScheduleLine['basis'];
      if (invoice !== undefined) {
        amount = invoice.total;
        basis = 'invoice';
      } else if (fromContract.amount !== null) {
        amount = fromContract.amount;
        basis = 'contract';
      } else {
        amount = null;
        basis = null;
      }

      return {
        order: line.order,
        title: line.title?.trim() || `Payment ${line.order}`,
        percent: line.percent,
        amount,
        basis,
        description: line.description,
        state: invoice === undefined ? 'upcoming' : isPaid(invoice) ? 'paid' : 'due',
      };
    });
}

export interface ClientScheduleSummary {
  /** The first line not yet paid — what the homeowner will be asked for next. */
  next: ClientScheduleLine | null;
  /** Known amounts on lines not yet billed. */
  upcomingTotal: number;
  /**
   * Upcoming lines with no figure at all. Reported rather than counted as zero,
   * so "$0 upcoming" can never be shown for a schedule nobody has priced.
   */
  upcomingUnpriced: number;
}

export function clientScheduleSummary(lines: readonly ClientScheduleLine[]): ClientScheduleSummary {
  let upcomingTotal = 0;
  let upcomingUnpriced = 0;
  for (const line of lines) {
    if (line.state !== 'upcoming') continue;
    if (line.amount === null) upcomingUnpriced += 1;
    else upcomingTotal += line.amount;
  }
  return {
    next: lines.find((l) => l.state !== 'paid') ?? null,
    upcomingTotal: Math.round(upcomingTotal * 100) / 100,
    upcomingUnpriced,
  };
}
