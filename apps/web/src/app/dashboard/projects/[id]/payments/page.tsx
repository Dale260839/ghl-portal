import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { PAYMENT_SCHEDULE } from '@/lib/data/portal-fixtures';
import { paymentSummary } from '@/lib/portal-data';
import { Badge, Card, StatTile, currency, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Paid: 'good',
  Invoiced: 'warn',
  Due: 'warn',
  'Not due': 'neutral',
};

/**
 * Payments — contractor control side. The payment schedule composed from the
 * client's proposal; a draft invoice is raised in GoHighLevel off a line. The
 * client sees the schedule and what they owe; the contractor raises the money.
 */
export default async function ProjectPaymentsControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const lines = PAYMENT_SCHEDULE.filter((p) => p.projectId === id).sort(
    (a, b) => a.position - b.position,
  );
  const summary = paymentSummary(lines);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Payments"
        subtitle="The schedule from the proposal. Raise a draft invoice in GoHighLevel off a line."
        clientHref={`/portal/payments?preview=${id}`}
        action={<ControlButton>Create invoice</ControlButton>}
      />

      <ControlNote>
        Each line comes from the client&rsquo;s payment schedule. Creating an invoice pushes a draft
        into GoHighLevel; when it is paid, the line flips to paid on both sides.
      </ControlNote>

      {lines.length === 0 ? (
        <ControlEmpty title="No schedule" body="No payment schedule has been composed for this project." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <StatTile label="Contract value" value={currency(summary.contractValue)} />
            <StatTile label="Paid" value={currency(summary.paid)} />
            <StatTile label="Outstanding" value={currency(summary.outstanding)} />
            <StatTile label="Upcoming" value={currency(summary.upcoming)} />
          </div>

          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs tracking-wide text-navy-400 uppercase">
                  <th className="px-5 py-3 font-medium">Milestone</th>
                  <th className="px-5 py-3 text-right font-medium">%</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Invoice</th>
                  <th className="px-5 py-3 font-medium">Client</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-navy-900">{l.milestone}</div>
                      <div className="text-xs text-navy-400">{l.terms}</div>
                    </td>
                    <td className="tabular px-5 py-3 text-right text-navy-900">{l.percentage}%</td>
                    <td className="tabular px-5 py-3 text-right font-medium text-navy-900">
                      {currency(l.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={TONE[l.status] ?? 'neutral'}>{l.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-navy-500">
                      {l.invoiceNumber !== '' ? (
                        <>
                          {l.invoiceNumber}
                          {l.dueDate !== '' && (
                            <div className="text-navy-400">due {shortDate(l.dueDate)}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-navy-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <VisibilityTag shown={project.clientPortalEnabled && l.clientVisible} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
