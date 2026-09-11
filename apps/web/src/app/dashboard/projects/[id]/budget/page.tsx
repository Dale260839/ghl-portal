import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { joinProposalsToProjects } from '@/lib/signed-work';
import { getHubSelections } from '@/lib/hub-db/selections';
import { Card, CardHeader, StatTile, currency } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';
import { ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Budget — the contractor's money tab for one project, on real figures only.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS USED TO BE, AND WHY IT HAD TO CHANGE
 *
 * A per-category ledger read from `BUDGET_LINES`, a fixture. Five columns of
 * money, a total row, and not one figure that came from anywhere. Chris asked
 * on 10 Sep for the money tabs to be real.
 *
 * THE RULE: A FIGURE IS SHOWN OR IT IS NOT SHOWN. IT IS NEVER ESTIMATED.
 *
 * BuildSuite records a budget BAND on a project ("$2,000 - $5,000") and a
 * numeric total on only some proposals. It is tempting to take the midpoint of
 * a band, and it would be wrong in the one direction that matters: a contractor
 * reading a contract value has no way to tell a derived number from an agreed
 * one, and the derived one is what an invoice would then be built against.
 *
 * So every figure here traces to a stated number, and anything absent reads
 * "not recorded" rather than $0. Zero is a claim. Blank is the truth.
 *
 * Read-only. Change orders and selections are created on their own screens;
 * this tab adds them up and says what the contract is now worth.
 * ---------------------------------------------------------------------------
 */

/** A figure, or the honest absence of one. Never a zero standing in for a blank. */
function money(value: number | null): string {
  return value === null ? 'not recorded' : currency(value);
}

/**
 * A sum over approved or pending rows. Three honest states, not two: the list
 * could not be read (not recorded), the list is empty (none yet), or there are
 * rows (a figure). The first version printed $0 for an empty list, which reads
 * as "changes were approved and they came to nothing" on a project where no
 * change order has ever been raised.
 */
function delta(value: number | null, count: number | null | undefined): string {
  if (value === null || count === null || count === undefined) return 'not recorded';
  if (count === 0) return 'none yet';
  return currency(value);
}

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

  const header = (
    <ControlHeader
      title="Budget"
      subtitle="What the contract is worth now: the signed total, plus what has been approved since."
      clientHref={`/portal/budget?preview=${id}`}
    />
  );

  if (scope.contractorId === undefined) {
    return (
      <div className="space-y-6">
        {header}
        <NotLinkedToContractor what="The budget" />
      </div>
    );
  }

  // ── The contract total ────────────────────────────────────────────────────
  //
  // From the SIGNED proposal for this project and nowhere else. An unsigned
  // proposal's figure is a quote, and a quote is not a contract value.
  const reader = getProposalsReader();
  let contractTotal: number | null = null;
  let contractNote = 'No signed contract for this project is readable, so there is no total to show.';

  if (reader.available) {
    const proposals = await reader
      .listForProjects(scope, [project.buildsuiteProjectId])
      .catch(() => []);
    const signing = joinProposalsToProjects([project], proposals)[0];
    const signed =
      signing !== undefined && signing.status === 'signed' ? signing.proposal : null;

    if (signed !== null) {
      contractTotal = signed.amount;
      contractNote =
        signed.amount === null
          ? `The signed contract records ${signed.priceText === '' ? 'no price' : `"${signed.priceText}"`}, which is not a figure. BuildSuite holds no contract total for this project.`
          : 'From the signed contract in BuildSuite.';
    }
  } else {
    contractNote = `BuildSuite is not connected here, so the contract total cannot be read. Missing: ${reader.missing.join(', ')}.`;
  }

  // ── Change orders and selections ──────────────────────────────────────────
  const hub = getHubSelections();
  const changeOrders = hub.available ? await hub.selections.listChangeOrders(scope, id) : null;
  const selections = hub.available ? await hub.selections.listSelections(scope, id) : null;

  // Added cost less any credit, plus the tax charged on it. That is the figure
  // the homeowner approved, so it is the figure the contract moved by.
  const netOf = (co: { addedCost: number; creditAmount: number; tax: number }) =>
    co.addedCost - co.creditAmount + co.tax;

  const approvedOrders = changeOrders?.filter((co) => co.status === 'Approved') ?? null;
  const pendingOrders = changeOrders?.filter((co) => co.status === 'Awaiting Client') ?? null;
  const approvedCo = approvedOrders === null ? null : approvedOrders.reduce((s, co) => s + netOf(co), 0);
  const pendingCo = pendingOrders === null ? null : pendingOrders.reduce((s, co) => s + netOf(co), 0);

  // An upgrade adds, a credit takes away. The allowance itself is already
  // inside the contract total, so it is deliberately not added here.
  const approvedSelections = selections?.filter((s) => s.status === 'Approved') ?? null;
  const selectionDelta =
    approvedSelections === null
      ? null
      : approvedSelections.reduce((sum, s) => sum + (s.upgradeAmount ?? 0) - (s.creditAmount ?? 0), 0);

  // Only computable when the contract total is a real number. Adding change
  // orders to an unknown gives an unknown, not a subtotal.
  const revised =
    contractTotal === null ? null : contractTotal + (approvedCo ?? 0) + (selectionDelta ?? 0);

  const budgetReleased = project.clientPortalEnabled && project.showBudgetToClient;

  return (
    <div className="space-y-6">
      {header}

      <ControlNote>
        Every figure here comes from a stated number: the signed contract, an approved change order,
        or an approved selection. Nothing is estimated from a budget band, so a blank means the
        figure is not recorded rather than nothing being owed.
      </ControlNote>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Contract total" value={money(contractTotal)} sub={contractNote} />
        <StatTile
          label="Approved change orders"
          value={delta(approvedCo, approvedOrders?.length)}
          sub={
            approvedOrders === null
              ? 'The Hub database is not connected.'
              : `${approvedOrders.length} approved`
          }
          tone={approvedCo !== null && approvedCo > 0 ? 'good' : 'default'}
        />
        <StatTile
          label="Pending change orders"
          value={delta(pendingCo, pendingOrders?.length)}
          sub={
            pendingOrders === null
              ? 'The Hub database is not connected.'
              : `${pendingOrders.length} awaiting the client`
          }
          tone={pendingCo !== null && pendingCo > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Revised contract"
          value={money(revised)}
          sub={
            revised === null
              ? 'Needs a contract total first.'
              : 'Contract plus approved change orders and selections.'
          }
        />
      </div>

      <Card>
        <CardHeader
          title="How it adds up"
          action={<VisibilityTag shown={budgetReleased} />}
        />
        <table className="w-full text-sm">
          <tbody className="divide-y divide-navy-100">
            <tr>
              <td className="px-5 py-3 text-navy-900">Contract total</td>
              <td className="px-5 py-3 text-xs text-navy-400">{contractNote}</td>
              <td className="tabular px-5 py-3 text-right font-medium text-navy-900">
                {money(contractTotal)}
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3 text-navy-900">Approved change orders</td>
              <td className="px-5 py-3 text-xs text-navy-400">
                Added cost less credits, plus tax, on change orders the client has approved.
              </td>
              <td className="tabular px-5 py-3 text-right font-medium text-navy-900">
                {delta(approvedCo, approvedOrders?.length)}
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3 text-navy-900">Approved selections</td>
              <td className="px-5 py-3 text-xs text-navy-400">
                Upgrades less credits on approved selections. The allowance itself already sits
                inside the contract total.
              </td>
              <td className="tabular px-5 py-3 text-right font-medium text-navy-900">
                {delta(selectionDelta, approvedSelections?.length)}
              </td>
            </tr>
            <tr className="bg-navy-50/50">
              <td className="px-5 py-3 font-semibold text-navy-900">Revised contract</td>
              <td className="px-5 py-3 text-xs text-navy-400">
                {revised === null
                  ? 'Shown once BuildSuite holds a contract total for this project.'
                  : 'What the job is worth today.'}
              </td>
              <td className="tabular px-5 py-3 text-right font-semibold text-navy-900">
                {money(revised)}
              </td>
            </tr>
            <tr>
              <td className="px-5 py-3 text-navy-900">Pending change orders</td>
              <td className="px-5 py-3 text-xs text-navy-400">
                Not in the revised total. The client has not approved these yet.
              </td>
              <td className="tabular px-5 py-3 text-right text-navy-500">{delta(pendingCo, pendingOrders?.length)}</td>
            </tr>
          </tbody>
        </table>
        <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
          {budgetReleased
            ? 'The client can see the budget on their own screen. Margin and markup are never part of it.'
            : 'The client cannot see the budget. Turn on "Show Budget to Client" under Visibility to release it.'}
        </p>
      </Card>
    </div>
  );
}
