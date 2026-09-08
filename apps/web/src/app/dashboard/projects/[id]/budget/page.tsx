import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { BUDGET_LINES } from '@/lib/data/portal-fixtures';
import { budgetTotals } from '@/lib/portal-data';
import { Badge, Card, currency } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote } from '@/components/control';

/**
 * Budget — contractor control side. The per-category ledger the client reads on
 * their Budget & Pricing screen, shown here in full. Client visibility is
 * governed by the master switch plus "Show Budget to Client"; the numbers
 * themselves are the same, because this type carries no cost or margin field to
 * withhold.
 */
export default async function ProjectBudgetControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const lines = BUDGET_LINES.filter((b) => b.projectId === id);
  const totals = budgetTotals(lines);
  const budgetReleased = project.clientPortalEnabled && project.showBudgetToClient;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Budget"
        subtitle="The per-category ledger, and whether the client can see it."
        clientHref={`/portal/budget?preview=${id}`}
      />

      <ControlNote>
        {budgetReleased ? (
          <>
            The budget is <strong className="font-semibold text-navy-900">visible</strong> to this
            client.
          </>
        ) : (
          <>
            The budget is <strong className="font-semibold text-navy-900">hidden</strong> from this
            client. Turn on &ldquo;Show Budget to Client&rdquo; under Visibility to release it.
          </>
        )}{' '}
        Margin and markup live on the project record, never on this ledger.
      </ControlNote>

      {lines.length === 0 ? (
        <ControlEmpty title="No budget lines" body="No categories have been costed for this project yet." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-100 text-left text-xs tracking-wide text-navy-400 uppercase">
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 text-right font-medium">Contracted</th>
                <th className="px-5 py-3 text-right font-medium">Change orders</th>
                <th className="px-5 py-3 text-right font-medium">Invoiced</th>
                <th className="px-5 py-3 text-right font-medium">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-5 py-3 font-medium text-navy-900">{l.category}</td>
                  <td className="tabular px-5 py-3 text-right text-navy-900">
                    {currency(l.contracted)}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-navy-900">
                    {currency(l.changeOrders)}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-navy-900">
                    {currency(l.invoiced)}
                  </td>
                  <td className="tabular px-5 py-3 text-right text-navy-900">
                    {currency(l.paid)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-navy-100 font-semibold">
                <td className="px-5 py-3 text-navy-900">
                  Total <Badge tone="accent">{currency(totals.total)}</Badge>
                </td>
                <td className="tabular px-5 py-3 text-right text-navy-900">
                  {currency(totals.contracted)}
                </td>
                <td className="tabular px-5 py-3 text-right text-navy-900">
                  {currency(totals.changeOrders)}
                </td>
                <td className="tabular px-5 py-3 text-right text-navy-900">
                  {currency(totals.invoiced)}
                </td>
                <td className="tabular px-5 py-3 text-right text-navy-900">
                  {currency(totals.paid)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </div>
  );
}
