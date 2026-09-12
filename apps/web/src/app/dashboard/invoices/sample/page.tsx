import Link from 'next/link';
import { paymentScheduleDrafts, percentTotal, parsePaymentSchedule } from '@/lib/payment-schedule';
import { Badge, Card, CardHeader, currency } from '@/components/ui';

/**
 * The invoice review screen on SAMPLE data.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PAGE EXISTS
 *
 * No signed proposal in BuildSuite currently points at a project this
 * deployment can read, so `/dashboard/invoices` has never had a contract to
 * show. Chris still needs to see how the review step works before the pilot
 * data arrives. This page runs the REAL parser and the REAL draft rules over
 * two invented contracts and renders the same card the live screen renders.
 *
 * What it deliberately does not do: read BuildSuite, read or write the Hub,
 * or reach GoHighLevel. Every control is disabled and the page says "sample"
 * at the top, on every card and on every button, so nobody mistakes it for a
 * live invoice.
 * ---------------------------------------------------------------------------
 */

interface SampleContract {
  id: string;
  projectName: string;
  projectId: string;
  /**
   * What the screen shows to identify the job. A code, like the real screens
   * print, rather than the fixture id; clearly marked as a sample.
   */
  projectCode: string;
  priceText: string;
  contractTotal: number | null;
  content: string;
  /** Lines the "contractor" has already saved, to show the later states. */
  saved: Record<number, { title: string; amount: number; externalId?: string }>;
}

const SAMPLES: SampleContract[] = [
  {
    id: 'sample-a',
    projectName: 'Master Bath Remodel (sample)',
    projectId: 'sample-project-a',
    projectCode: 'SAMPLE-001',
    priceText: '24500.00',
    contractTotal: 24500,
    content: `
## PAYMENT SCHEDULE

Owner agrees to pay Contractor as follows:

- **50%** upon acceptance of this contract and project scheduling
- **25%** upon start of construction
- **25%** upon completion of punch list

All payments are due upon invoice receipt unless otherwise stated.
`,
    saved: {
      1: { title: 'Deposit on signing', amount: 12250, externalId: 'sample-ghl-000195' },
      2: { title: 'Start of construction', amount: 6125 },
    },
  },
  {
    id: 'sample-b',
    projectName: 'Garage Door Replacement (sample)',
    projectId: 'sample-project-b',
    projectCode: 'SAMPLE-002',
    priceText: '$2,000 - $5,000',
    contractTotal: null,
    content: `
## PAYMENT SCHEDULE

- Contract Signing (10%)
- Completion (90%)
`,
    saved: {},
  },
];

const field =
  'rounded-lg border border-navy-200 bg-navy-50/60 px-3 py-2 text-sm text-navy-700 disabled:opacity-70';

export default function InvoicesSample() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-navy-900">Invoices</h1>
            <Badge tone="warn">Sample data</Badge>
          </div>
          <p className="mt-1 text-sm text-navy-400">
            How the review step works, on two invented contracts. Nothing here is read from
            BuildSuite, saved to the Hub or sent to GoHighLevel.
          </p>
        </div>
        <Link
          href="/dashboard/invoices"
          className="text-sm font-medium text-navy-700 underline underline-offset-2"
        >
          Back to live invoices
        </Link>
      </div>

      <Card className="px-5 py-4 text-xs leading-relaxed text-navy-600">
        <p className="font-medium text-navy-800">What you are looking at</p>
        <p className="mt-1">
          Each signed contract&apos;s payment schedule is parsed line by line. Every line becomes
          a draft invoice, the deposit and each milestone after it. An amount is only filled in
          when the proposal states it or when a percent can be applied to a recorded contract
          total. Otherwise it stays blank for you to supply. Blank, never zero.
        </p>
        <p className="mt-1">
          Contract A has a recorded total, so the amounts are computed. Contract B has only a
          price band, which is how every signed proposal in BuildSuite looks today, so its
          amounts wait for you.
        </p>
      </Card>

      {SAMPLES.map((sample, index) => {
        const lines = parsePaymentSchedule(sample.content);
        const drafts = paymentScheduleDrafts(sample.content, sample.contractTotal);
        const pct = percentTotal(lines);
        const letter = index === 0 ? 'A' : 'B';

        return (
          <Card key={sample.id}>
            <CardHeader
              title={`Contract ${letter} · ${sample.projectName}`}
              action={
                <span className="flex items-center gap-2">
                  <Badge tone="warn">Sample</Badge>
                  <Badge tone="good">Signed</Badge>
                </span>
              }
            />

            <div className="border-b border-navy-100 px-5 py-3 text-xs text-navy-500">
              <span className="font-medium text-navy-700">{sample.projectCode}</span>
              {' · '}
              {sample.contractTotal === null ? (
                <span className="text-amber-700">
                  no contract total recorded ({sample.priceText}), amounts cannot be calculated
                  from a percent
                </span>
              ) : (
                <>contract {currency(sample.contractTotal)}</>
              )}
              {pct !== null && pct !== 100 && (
                <span className="text-amber-700"> · schedule totals {pct}%, not 100%</span>
              )}
            </div>

            <ul className="divide-y divide-navy-100">
              {drafts.map((draft) => {
                const saved = sample.saved[draft.line.order];
                const amount = saved?.amount ?? draft.amount;
                const title = saved?.title ?? draft.line.title;
                const inGhl = saved?.externalId !== undefined;
                return (
                  <li key={draft.line.order} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-navy-500">
                        {draft.line.order === 1
                          ? 'Deposit · line 1'
                          : `Milestone · line ${draft.line.order}`}
                      </span>
                      <span className="text-xs text-navy-400">
                        {draft.amountSource === 'stated' && 'amount stated in the proposal'}
                        {draft.amountSource === 'computed' && 'amount computed from the percent'}
                        {draft.amountSource === 'unavailable' && 'amount not derivable'}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs break-words text-navy-400">
                      {draft.line.raw}
                    </p>
                    {draft.warnings.length > 0 && saved === undefined && (
                      <ul className="mt-2 space-y-1">
                        {draft.warnings.map((w) => (
                          <li key={w} className="text-xs text-amber-700">
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
                      <input
                        readOnly
                        disabled
                        value={title ?? ''}
                        placeholder="What this invoice is for"
                        className={field}
                      />
                      <input
                        readOnly
                        disabled
                        value={amount ?? ''}
                        placeholder="Amount"
                        className={field}
                      />
                      <button
                        type="button"
                        disabled
                        title="Sample data. Saving is disabled."
                        className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 opacity-40"
                      >
                        Save
                      </button>
                      <textarea
                        readOnly
                        disabled
                        rows={2}
                        value={draft.line.description}
                        placeholder="Payment terms shown on the invoice"
                        className={`${field} sm:col-span-3`}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-navy-100 pt-3">
                      {inGhl ? (
                        <>
                          <Badge tone="good">In GoHighLevel</Badge>
                          <span className="text-xs text-navy-500">
                            {saved!.externalId} · sample, no real invoice exists
                          </span>
                          <span className="text-xs font-medium text-navy-400">
                            Open it to send
                          </span>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled
                            title="Sample data. Nothing is created."
                            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white opacity-40"
                          >
                            Create in GoHighLevel
                          </button>
                          <span className="text-xs text-navy-400">
                            {saved === undefined
                              ? amount === null
                                ? 'Enter an amount first.'
                                : 'Save this line first.'
                              : 'Creates a draft. You send it from GoHighLevel.'}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
              Creating an invoice puts a draft in GoHighLevel. Nobody is emailed and nothing is
              charged until you open it there and send it.
            </p>
          </Card>
        );
      })}
    </div>
  );
}
