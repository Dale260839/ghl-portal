import { budgetFor, budgetTotals, currentPortalProject } from '@/lib/portal-data';
import { Card, PortalEmpty, currency } from '@/components/ui';

/**
 * Budget & Pricing — the per-category table, §9.3's allow-list only.
 *
 * Gated twice. The portal master switch, then §6.1 `Show Budget to Client` — a
 * contractor who turns the budget off gets nothing here, not a table with the
 * numbers blanked out.
 *
 * There is no cost, markup or margin column because `BudgetLine` has no field
 * for one. The type is the enforcement; this screen only has to render what it
 * was handed.
 */
export default async function PortalBudget({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const lines = budgetFor(project);
  const t = budgetTotals(lines);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Budget &amp; Pricing</h1>
        <p className="mt-1 text-sm text-navy-400">
          Your contract value, approved changes, and what has been billed.
        </p>
      </div>

      {lines.length === 0 ? (
        <PortalEmpty
          title="Budget not shared"
          body="Your contractor hasn't enabled the budget view for this project. Ask them if you'd like it turned on."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Original contract', t.contracted, 'as signed'],
              ['Approved changes', t.changeOrders, 'added since'],
              ['Current total', t.total, 'contract + changes'],
              ['Outstanding', t.outstanding, 'invoiced, not yet paid'],
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

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-navy-100 bg-navy-50/60 text-xs tracking-wide text-navy-400 uppercase">
                    <th className="px-5 py-2.5 font-medium">Category</th>
                    <th className="px-5 py-2.5 text-right font-medium">Contracted</th>
                    <th className="px-5 py-2.5 text-right font-medium">Changes</th>
                    <th className="px-5 py-2.5 text-right font-medium">Invoiced</th>
                    <th className="px-5 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {lines.map((l) => (
                    <tr key={l.id} className="transition hover:bg-navy-50/60">
                      <td className="px-5 py-3 text-sm font-medium text-navy-900">{l.category}</td>
                      <td className="tabular px-5 py-3 text-right text-sm text-navy-600">
                        {currency(l.contracted)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-sm text-navy-600">
                        {l.changeOrders === 0 ? '—' : currency(l.changeOrders)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-sm text-navy-600">
                        {currency(l.invoiced)}
                      </td>
                      <td className="tabular px-5 py-3 text-right text-sm text-navy-900">
                        {currency(l.paid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-navy-100 bg-navy-50/60 font-semibold">
                    <td className="px-5 py-3 text-sm text-navy-900">Total</td>
                    <td className="tabular px-5 py-3 text-right text-sm text-navy-900">
                      {currency(t.contracted)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-sm text-navy-900">
                      {currency(t.changeOrders)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-sm text-navy-900">
                      {currency(t.invoiced)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-sm text-navy-900">
                      {currency(t.paid)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <p className="text-xs leading-relaxed text-navy-400">
            These are contract figures: what you agreed, what has changed since, and what has been
            billed and paid. Your contractor&apos;s own costs and margin are not part of your
            contract and are never shown.
          </p>
        </>
      )}
    </div>
  );
}
