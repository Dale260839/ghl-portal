/**
 * Reading a proposal's payment schedule, the source of every invoice.
 *
 * ---------------------------------------------------------------------------
 * WHERE THIS SHAPE COMES FROM
 *
 * Not from a spec — from the live database, read 2026-09-05. There is no
 * payment-schedule table. The schedule lives inside `proposals.sections`, under
 * `payment_schedule`, as an array of lines. Two shapes appear in real rows and
 * both are handled here:
 *
 *   basic:  { milestone, percentage, amount }
 *   rich:   { milestone, percentage, amount, trigger, due_description }
 *
 * Chris's rule (2 Sep): the FIRST line becomes the first invoice, and each
 * later line triggers its own invoice as the job reaches that milestone. So the
 * order of the array is load-bearing, and this module preserves it exactly.
 *
 * This is the adapter §3 of CLAUDE.md asks for: our own type on one side, the
 * real proposal JSON on the other, and the mapping in one place. If BuildSuite
 * moves the schedule, this file changes and nothing downstream does.
 * ---------------------------------------------------------------------------
 */

/** One line of a payment schedule, normalized. Money is a number of dollars. */
export interface PaymentScheduleLine {
  /** 1-based position in the schedule. Line 1 is the first invoice. */
  readonly position: number;
  /** The milestone name, e.g. "Contract Signing & Scheduling". */
  readonly milestone: string;
  /** Share of the contract, 0–100. `null` when the row omitted it. */
  readonly percentage: number | null;
  /** The dollar amount for this line. `null` when the row omitted it. */
  readonly amount: number | null;
  /**
   * The terms text a contractor would put on the invoice. Prefers the richer
   * `trigger`, falls back to `due_description`, and is `''` when neither exists.
   */
  readonly terms: string;
}

export interface PaymentSchedule {
  readonly lines: readonly PaymentScheduleLine[];
  /** The first line, which becomes the first invoice. `null` when empty. */
  readonly first: PaymentScheduleLine | null;
  /** Sum of the line amounts, for cross-checking against the proposal total. */
  readonly amountTotal: number;
}

/** The raw proposal shape, as it actually arrives from PostgREST. */
export interface ProposalSections {
  payment_schedule?: unknown;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalize one raw line. Returns `null` for a line with no milestone, because
 * a nameless line is not something a contractor could sensibly invoice, and
 * carrying it would put a blank row on a client's invoice.
 */
function normalizeLine(raw: unknown, position: number): PaymentScheduleLine | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;

  const milestone = toText(row.milestone) || toText(row.name) || toText(row.title);
  if (milestone === '') return null;

  // `trigger` is the fuller sentence; `due_description` the short one. Prefer
  // the fuller, since it is what the real rich rows put the actual terms in.
  const terms = toText(row.trigger) || toText(row.due_description) || toText(row.description);

  return {
    position,
    milestone,
    percentage: toNumber(row.percentage),
    amount: toNumber(row.amount),
    terms,
  };
}

/**
 * Parse a proposal's `sections` into a payment schedule.
 *
 * Tolerant on purpose. `sections` can be an object, occasionally a JSON string,
 * or absent, and a proposal with no schedule is a normal state, not an error —
 * it yields an empty schedule whose `first` is `null`, and the caller decides
 * what to do (Chris's rule: the contractor sees the blank and fills it in).
 */
export function parsePaymentSchedule(sections: unknown): PaymentSchedule {
  let parsed: unknown = sections;
  if (typeof sections === 'string') {
    try {
      parsed = JSON.parse(sections);
    } catch {
      parsed = null;
    }
  }

  const raw =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as ProposalSections).payment_schedule
      : undefined;

  const rawLines = Array.isArray(raw) ? raw : [];

  const lines: PaymentScheduleLine[] = [];
  for (const rawLine of rawLines) {
    const line = normalizeLine(rawLine, lines.length + 1);
    if (line !== null) lines.push(line);
  }

  const amountTotal = lines.reduce((sum, l) => sum + (l.amount ?? 0), 0);

  return {
    lines,
    first: lines[0] ?? null,
    amountTotal: Math.round(amountTotal * 100) / 100,
  };
}

/**
 * Does the schedule's own amounts add up to the proposal total?
 *
 * A soft check, not a gate. A contractor reviews and can adjust every invoice
 * before sending (Chris's rule), so a mismatch is worth surfacing, never worth
 * blocking on. Returns `null` when there is nothing to compare against.
 */
export function scheduleMatchesTotal(
  schedule: PaymentSchedule,
  proposalTotal: number | null,
  toleranceDollars = 1,
): boolean | null {
  if (proposalTotal === null || schedule.lines.length === 0) return null;
  return Math.abs(schedule.amountTotal - proposalTotal) <= toleranceDollars;
}
