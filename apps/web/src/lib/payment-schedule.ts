/**
 * The payment schedule inside a proposal, as structured lines.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LIVE DATA ACTUALLY LOOKS LIKE (measured 2026-09-03, all 46 proposals)
 *
 * The handoff describes a schedule line as a title, a percent, a dollar amount
 * and a description — "Contract Signing, Scheduling & Permit Start, 30%,
 * $25,434.00". That shape exists, but it is the minority:
 *
 *   33 of 46 proposals have a PAYMENT SCHEDULE section at all
 *    4 of those 33 contain a dollar amount anywhere in it
 *
 * There is no payment-schedule table. The schedule lives inside
 * `proposals.content`, which is **markdown prose**, not structured data —
 * `proposals.sections` is null on every row in the database.
 *
 * Three line shapes occur, and all three are handled here:
 *
 *   - **50%** upon acceptance of this contract and project scheduling
 *   - Contract Signing (10%)
 *   - **Contract Signing & Scheduling** (30% — $1,773.75)
 *
 * Only the third gives a title, a percent AND an amount. The first gives no
 * title; the first two give no money.
 * ---------------------------------------------------------------------------
 *
 * So this parser reports what is there and **never invents what is not**. A
 * missing title stays null rather than becoming the description; a missing
 * amount stays null rather than becoming zero. Zero is a number a contractor
 * could send to a homeowner by accident, and null is not.
 */

export interface ScheduleLine {
  /** Position in the schedule, 1-based. The first line is the deposit. */
  order: number;
  /** The milestone name, when the proposal names one. Never inferred. */
  title: string | null;
  /** Percent of the contract, 0–100. Null when the line states none. */
  percent: number | null;
  /**
   * Dollars, when the proposal states them.
   *
   * Null is the COMMON case — 29 of 33 schedules state no money at all. This
   * is the field the contractor fills in at review.
   */
  amount: number | null;
  /** The prose. Chris: the description acts as the payment terms. */
  description: string;
  /** The line exactly as written, so a contractor can check the parse. */
  raw: string;
}

/** Matches `## PAYMENT SCHEDULE` through to the next heading or rule. */
const SECTION = /##\s*PAYMENT\s+SCHEDULE\s*\n([\s\S]*?)(?=\n\s*##|\n\s*---|$)/i;

/** `$1,773.75` or `$25,434` — the thousands separators are optional. */
const MONEY = /\$\s*([\d,]+(?:\.\d{1,2})?)/;

/** `30%` anywhere in the line, bold or not. */
const PERCENT = /(\d+(?:\.\d+)?)\s*%/;

/**
 * `**Title** (…)` — a bolded run that is NOT itself just a percent.
 *
 * The distinction matters: `- **50%** upon acceptance…` bolds the percent, not
 * a title. Treating that bold run as a milestone name would put "50%" in the
 * title of an invoice sent to a homeowner.
 */
const BOLD = /\*\*(.+?)\*\*/;

/** `- Contract Signing (10%)` — a title preceding a parenthesised percent. */
const TITLE_BEFORE_PAREN = /^(.+?)\s*\(/;

function parseMoney(text: string): number | null {
  const match = MONEY.exec(text);
  if (match === null) return null;
  const value = Number(match[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function parsePercent(text: string): number | null {
  const match = PERCENT.exec(text);
  if (match === null) return null;
  const value = Number(match[1]);
  // A schedule line over 100% is a parse gone wrong, not a real term.
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function parseTitle(body: string, percent: number | null): string | null {
  const bold = BOLD.exec(body);
  if (bold !== null) {
    const inner = bold[1]!.trim();
    // A bolded percent is not a title. `- **50%** upon acceptance…`
    const isJustPercent = /^\d+(\.\d+)?\s*%$/.test(inner);
    if (!isJustPercent && inner !== '') return inner;
  }

  // `- Contract Signing (10%)` — text before the parenthesis, but only when
  // the parenthesis is where the percent lives. Otherwise the "title" would be
  // an arbitrary sentence fragment.
  if (percent !== null && /\([^)]*%[^)]*\)/.test(body)) {
    const before = TITLE_BEFORE_PAREN.exec(body);
    if (before !== null) {
      const candidate = before[1]!.replace(/\*/g, '').trim();
      if (candidate !== '' && !/^\d+(\.\d+)?\s*%$/.test(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * The description: the prose, with the structured bits taken out.
 *
 * Chris's rule is that the description carries onto the invoice as the payment
 * terms, so it has to read as a sentence. For `- **50%** upon acceptance of
 * this contract` that is "upon acceptance of this contract"; for a line whose
 * whole content is a title and figures, it is empty rather than a restatement.
 */
function parseDescription(body: string, title: string | null): string {
  let text = body;
  if (title !== null) {
    text = text.replace(`**${title}**`, '').replace(title, '');
  }
  return text
    .replace(/\([^)]*%[^)]*\)/g, '')
    .replace(/\*\*\d+(\.\d+)?\s*%\*\*/g, '')
    .replace(/\d+(\.\d+)?\s*%/g, '')
    .replace(MONEY, '')
    .replace(/\*/g, '')
    .replace(/^[\s—–\-:,]+|[\s—–\-:,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Every payment schedule line in a proposal, in order.
 *
 * Returns `[]` — never throws — when the proposal has no content, no schedule
 * section, or a section with no list items. An empty schedule is a real and
 * common state, and Chris's rule is that the contractor catches it at the
 * review step, so it must reach that step rather than failing earlier.
 */
export function parsePaymentSchedule(content: string | null | undefined): ScheduleLine[] {
  if (content === null || content === undefined || content.trim() === '') return [];

  const section = SECTION.exec(content);
  if (section === null) return [];

  const lines: ScheduleLine[] = [];
  for (const rawLine of section[1]!.split('\n')) {
    const raw = rawLine.trim();
    // List items only. Prose like "All payments are due upon invoice receipt"
    // is a term of the contract, not an instalment.
    if (!/^[-*]\s+/.test(raw)) continue;

    const body = raw.replace(/^[-*]\s+/, '').trim();
    if (body === '') continue;

    const percent = parsePercent(body);
    const amount = parseMoney(body);
    const title = parseTitle(body, percent);

    // A bullet with neither a percent nor an amount is prose that happens to be
    // in a list — not an instalment anybody can invoice.
    if (percent === null && amount === null) continue;

    lines.push({
      order: lines.length + 1,
      title,
      percent,
      amount,
      description: parseDescription(body, title),
      raw,
    });
  }

  return lines;
}

/** How an invoice draft arrived at its amount. Shown to the contractor. */
export type AmountSource = 'stated' | 'computed' | 'unavailable';

export interface InvoiceDraft {
  line: ScheduleLine;
  /** Null when neither the proposal nor a contract total can supply one. */
  amount: number | null;
  amountSource: AmountSource;
  /**
   * True when a person has to supply or confirm something before this can be
   * sent. The draft is always created; this decides what the review screen
   * asks for.
   */
  needsContractorInput: boolean;
  /** Plain-language reasons, for the review screen. Empty when clean. */
  warnings: string[];
}

/**
 * Turn one schedule line into a draft invoice.
 *
 * **Never computes an amount it cannot justify.** The order is: the amount the
 * proposal states, then percent × contract total, then nothing. It does not
 * fall back to zero — a zero invoice is a number a contractor could send by
 * accident, and blank is the honest representation of "we do not know".
 *
 * This matters more than it looks on the live data: `proposals.total` is null
 * on all four signed proposals, and `proposals.price` is a band string like
 * "$2,000 - $5,000" rather than a figure. So today most drafts land on
 * `unavailable`, and that is the correct output, not a failure — Chris's own
 * rule is that the contractor catches a blank schedule at review.
 */
export function draftInvoiceFor(
  line: ScheduleLine,
  contractTotal: number | null,
): InvoiceDraft {
  const warnings: string[] = [];

  let amount: number | null = null;
  let amountSource: AmountSource = 'unavailable';

  if (line.amount !== null) {
    amount = line.amount;
    amountSource = 'stated';
  } else if (line.percent !== null && contractTotal !== null && contractTotal > 0) {
    // Rounded to cents, because an invoice is money and a repeating decimal is
    // not a figure anyone can pay.
    amount = Math.round(contractTotal * (line.percent / 100) * 100) / 100;
    amountSource = 'computed';
  } else {
    warnings.push(
      line.percent === null
        ? 'This line states no percent and no amount. Enter the amount to invoice.'
        : 'No contract total is recorded on the proposal, so the percent cannot be turned into an amount. Enter it.',
    );
  }

  if (line.title === null) {
    warnings.push('The proposal does not name this milestone. Add a title for the invoice.');
  }

  return {
    line,
    amount,
    amountSource,
    needsContractorInput: warnings.length > 0,
    warnings,
  };
}

/**
 * The deposit draft: the first schedule line.
 *
 * Deliberately built on `paymentScheduleDrafts` rather than special-casing the
 * first line, because the handoff is explicit that this must not hardcode
 * "first line only" — each later line becomes its own invoice at its milestone.
 */
export function depositDraft(
  content: string | null | undefined,
  contractTotal: number | null,
): InvoiceDraft | null {
  return paymentScheduleDrafts(content, contractTotal)[0] ?? null;
}

/** Every line as a draft, in schedule order — the invoice timeline. */
export function paymentScheduleDrafts(
  content: string | null | undefined,
  contractTotal: number | null,
): InvoiceDraft[] {
  return parsePaymentSchedule(content).map((line) => draftInvoiceFor(line, contractTotal));
}

/**
 * Whether the percentages add up.
 *
 * Not enforced anywhere — it is shown to the contractor at review. A schedule
 * totalling 90% is usually a typo, but it is the contractor's contract and not
 * ours to reject.
 */
export function percentTotal(lines: ScheduleLine[]): number | null {
  const stated = lines.filter((l) => l.percent !== null);
  if (stated.length === 0) return null;
  return Math.round(stated.reduce((sum, l) => sum + l.percent!, 0) * 100) / 100;
}
