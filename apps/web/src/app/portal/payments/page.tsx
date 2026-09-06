import { currentPortalProject, paymentsFor, paymentSummary } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty, currency, shortDate } from '@/components/ui';

/**
 * Payments — the client half of the payment schedule (§6.4).
 *
 * The homeowner sees the draw schedule from their own proposal, and where each
 * milestone stands: paid, invoiced and outstanding, or not yet due. This is the
 * same schedule the invoicing code composes invoices from, so what a client
 * reads here and what a contractor bills come from one source.
 *
 * There is no cost or margin anywhere on this screen because `ClientPaymentLine`
 * has no field for one. The type is the gate; this screen only renders what it
 * was handed.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Paid: 'good',
  Invoiced: 'warn',
  Due: 'warn',
  'Not due': 'neutral',
};

export default async function PortalPayments({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const lines = paymentsFor(project);
  const s = paymentSummary(lines);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Payments</h1>
        <p className="mt-1 text-sm text-navy-400">
          Your payment schedule, and where each milestone stands.
        </p>
      </div>

      {lines.length === 0 ? (
        <PortalEmpty
          title="No payment schedule shared yet"
          body="Your contractor hasn't published a payment schedule for this project. It appears here once your proposal is finalized."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Contract value', s.contractValue, 'total across all milestones'],
              ['Paid to date', s.paid, 'thank you'],
              ['Outstanding', s.outstanding, 'invoiced, awaiting payment'],
              ['Upcoming', s.upcoming, 'not yet due'],
            ].map(([label, value, sub]) => (
              <Card key={label as string} className="px-4 py-3.5">
                <div className="text-xs tracking-wide text-navy-400 uppercase">{label}</div>
                <div className="tabular mt-1 text-lg font-semibold text-navy-900">
                  {currency(value as number)}
                </div>
                <div className="mt-0.5 text-xs text-navy-400">{sub}</div>
              </Card>
            ))}
          </div>

          {s.outstanding > 0 && (
            <Card className="border-amber-accent/30 bg-amber-soft px-5 py-4">
              <div className="text-sm font-semibold text-navy-900">
                {currency(s.outstanding)} is due now
              </div>
              <p className="mt-1 text-sm text-navy-600">
                An invoice has been sent for the milestone below. Your contractor handles payment
                through your secure account. Reach out to them with any questions on an invoice.
              </p>
            </Card>
          )}

          <div className="space-y-3">
            {lines.map((line) => (
              <Card key={line.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="tabular text-xs font-medium text-navy-400">
                        {line.position}
                      </span>
                      <span className="text-sm font-semibold text-navy-900">{line.milestone}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">{line.terms}</div>
                  </div>
                  <Badge tone={TONE[line.status] ?? 'neutral'}>{line.status}</Badge>
                </div>

                <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="tabular text-lg font-semibold text-navy-900">
                    {currency(line.amount)}
                    <span className="ml-1.5 text-xs font-normal text-navy-400">
                      {line.percentage}% of contract
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 text-xs text-navy-400">
                    {line.invoiceNumber !== '' && <span>Invoice #{line.invoiceNumber}</span>}
                    {line.status === 'Invoiced' && line.dueDate !== '' && (
                      <span>Due {shortDate(line.dueDate)}</span>
                    )}
                    {line.status === 'Paid' && line.paidDate !== '' && (
                      <span>Paid {shortDate(line.paidDate)}</span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <p className="text-xs leading-relaxed text-navy-400">
            This is your agreed payment schedule and its progress. Amounts are your contract draws,
            not your contractor&apos;s costs, which are never part of what you are billed. Invoices
            are issued and paid through your secure account.
          </p>
        </>
      )}
    </div>
  );
}
