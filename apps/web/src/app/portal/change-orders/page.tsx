import { changeOrdersFor, currentPortalProject } from '@/lib/portal-data';
import { changeOrderNet, changeOrderTotals } from '@/lib/data/types';
import type { ChangeOrder } from '@/lib/data/types';
import { Badge, Card, PortalEmpty } from '@/components/ui';

/**
 * §6.6 Change Orders — the client's half.
 *
 * Three things this screen has to get right:
 *
 * **The number is the reference.** "Change order two" is how a homeowner and a
 * PM talk about it on the phone, so CO-002 leads each row rather than a title.
 *
 * **Only approved money is presented as money.** A pending change has not moved
 * the contract. It is shown separately and never folded into the total, because
 * a client who reads a pending figure as agreed will dispute the invoice.
 *
 * **Approve is a real decision, so it is not the only option.** "Ask a question"
 * sits beside it — a client who feels cornered into approving stops trusting the
 * portal, and a question routed to the PM is cheaper than a dispute.
 *
 * PROVISIONAL: the actions post nowhere yet. The approval write-path is the
 * change-order workflow, which is not built — see the PR note. The buttons are
 * rendered disabled rather than wired to a no-op, so nothing implies success
 * that did not happen.
 */

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusTone(status: ChangeOrder['status']): 'good' | 'warn' | 'neutral' {
  if (status === 'Approved') return 'good';
  if (status === 'Client Review Pending') return 'warn';
  return 'neutral';
}

/** What the client is being asked to do, in their words rather than the status code. */
function statusLabel(status: ChangeOrder['status']): string {
  if (status === 'Client Review Pending') return 'Awaiting your approval';
  if (status === 'Revision Requested') return 'Revision requested';
  return status;
}

function ImpactCell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <div className="text-xs tracking-wide text-navy-400 uppercase">{label}</div>
      <div
        className={`mt-0.5 text-sm font-semibold tabular-nums ${
          muted ? 'text-navy-400' : 'text-navy-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ChangeOrderCard({ co }: { co: ChangeOrder }) {
  const net = changeOrderNet(co);
  const awaiting = co.status === 'Client Review Pending';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold tracking-wide text-navy-400">
              CO-{co.changeOrderNumber}
            </span>
            <Badge tone={statusTone(co.status)}>{statusLabel(co.status)}</Badge>
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-navy-900">{co.title}</h2>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums text-navy-900">
            {net === 0 ? 'No cost' : money(net)}
          </div>
          {co.creditAmount > 0 && (
            <div className="text-xs text-navy-400 tabular-nums">
              {money(co.addedCost)} less {money(co.creditAmount)} credit
            </div>
          )}
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-navy-700">{co.description}</p>

      <p className="mt-2 text-sm text-navy-500">
        <span className="font-medium text-navy-600">Why:</span> {co.reason}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-navy-100 pt-3 sm:grid-cols-4">
        <ImpactCell
          label="Schedule"
          value={
            co.scheduleImpactDays === 0
              ? 'No change'
              : `+${co.scheduleImpactDays} ${co.scheduleImpactDays === 1 ? 'day' : 'days'}`
          }
          muted={co.scheduleImpactDays === 0}
        />
        <ImpactCell
          label="Revised completion"
          value={co.revisedCompletionDate === null ? '—' : longDate(co.revisedCompletionDate)}
          muted={co.revisedCompletionDate === null}
        />
        <ImpactCell label="Requested" value={longDate(co.createdDate)} />
        {co.status === 'Approved' && co.approvalDate !== null ? (
          <ImpactCell label="Approved" value={longDate(co.approvalDate)} />
        ) : (
          <ImpactCell
            label="Respond by"
            value={co.approvalDeadline === null ? '—' : longDate(co.approvalDeadline)}
            muted={co.approvalDeadline === null}
          />
        )}
      </div>

      {co.clientComments !== '' && (
        <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700">
          <span className="font-medium">Your note:</span> {co.clientComments}
        </p>
      )}

      {awaiting && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
          <button
            type="button"
            disabled
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Approve
          </button>
          <button
            type="button"
            disabled
            className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask a question
          </button>
          <span className="text-xs text-navy-400">
            Approval opens in your secure portal account.
          </span>
        </div>
      )}

      {co.status === 'Approved' && co.approvedBy !== null && (
        <p className="mt-3 border-t border-navy-100 pt-3 text-xs text-navy-400">
          Approved by {co.approvedBy}
          {co.approvalDate !== null && ` on ${longDate(co.approvalDate)}`}.
        </p>
      )}
    </Card>
  );
}

export default async function PortalChangeOrders({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const orders = changeOrdersFor(project);
  const { approved, pending } = changeOrderTotals(orders);
  // `contractAmount` is the original scope; `currentProjectTotal` already includes
  // approved changes. Read both rather than recomputing — the PM sees these exact
  // figures, and a client seeing a different total is worse than showing none.
  const original = project.contractAmount;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Change Orders</h1>
        <p className="mt-1 text-sm text-navy-400">
          Modifications to the project scope, and what each one changes.
        </p>
      </div>

      {orders.length === 0 ? (
        <PortalEmpty
          title="No change orders"
          body="Nothing has changed from the original scope of work. Anything that does will appear here with its cost and schedule impact before it goes ahead."
        />
      ) : (
        <>
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">
                  Original contract
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {money(original)}
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">
                  Approved changes
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {approved === 0 ? '—' : `+${money(approved)}`}
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Current total</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {money(project.currentProjectTotal)}
                </div>
              </div>
            </div>
            {pending !== 0 && (
              <p className="mt-4 border-t border-navy-100 pt-3 text-sm text-navy-500">
                <span className="font-medium text-navy-700">{money(pending)} awaiting approval.</span>{' '}
                Not included in the total above — nothing is added to your contract until you
                approve it.
              </p>
            )}
          </Card>

          <div className="space-y-4">
            {orders.map((co) => (
              <ChangeOrderCard key={co.id} co={co} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
