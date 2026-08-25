import { changeOrdersFor, currentPortalProject } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty, currency, shortDate } from '@/components/ui';

/**
 * Change Orders — §6.6, the client half.
 *
 * Only change orders marked client-visible appear. A change order we absorb
 * ourselves — our own error, not billed on — is not the client's business, and
 * the fixtures include one precisely so the withholding is demonstrable.
 *
 * The total shown is added cost plus tax, less credit: the same arithmetic WF6
 * uses when it moves the contract total, so the number the client approves is
 * the number that lands.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Approved: 'good',
  'Awaiting Client': 'warn',
  Rejected: 'warn',
};

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
  const waiting = orders.filter((c) => c.status === 'Awaiting Client');
  const approvedTotal = orders
    .filter((c) => c.status === 'Approved')
    .reduce((sum, c) => sum + c.addedCost + c.tax - c.creditAmount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Change Orders</h1>
        <p className="mt-1 text-sm text-navy-400">
          Anything that changes the scope, the price, or the finish date.
        </p>
      </div>

      {orders.length === 0 ? (
        <PortalEmpty
          title="No change orders"
          body="Nothing has changed from the original scope on this project."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="px-4 py-3.5">
              <div className="text-xs tracking-wide text-navy-400 uppercase">Approved to date</div>
              <div className="tabular mt-1 text-lg font-semibold text-navy-900">
                {currency(approvedTotal)}
              </div>
              <div className="mt-0.5 text-xs text-navy-400">added to your contract</div>
            </Card>
            <Card
              className={`px-4 py-3.5 ${waiting.length > 0 ? 'border-amber-accent/30 bg-amber-soft' : ''}`}
            >
              <div className="text-xs tracking-wide text-navy-400 uppercase">Waiting on you</div>
              <div className="tabular mt-1 text-lg font-semibold text-navy-900">
                {waiting.length}
              </div>
              <div className="mt-0.5 text-xs text-navy-400">
                {waiting.length === 0 ? 'nothing outstanding' : 'needs your decision'}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            {orders.map((c) => {
              const net = c.addedCost + c.tax - c.creditAmount;
              return (
                <Card key={c.id} className="px-5 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-navy-900">
                        {c.changeOrderNumber} · {c.title}
                      </div>
                      <div className="mt-0.5 text-xs text-navy-400">
                        Requested by {c.requestedBy} on {shortDate(c.createdDate)}
                      </div>
                    </div>
                    <Badge tone={TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-navy-600">{c.description}</p>

                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs tracking-wide text-navy-400 uppercase">
                        {net < 0 ? 'Credit' : 'Added to contract'}
                      </dt>
                      <dd className="tabular mt-0.5 font-medium text-navy-900">
                        {currency(Math.abs(net))}
                      </dd>
                      {c.tax > 0 && (
                        <dd className="text-xs text-navy-400">includes {currency(c.tax)} tax</dd>
                      )}
                    </div>
                    <div>
                      <dt className="text-xs tracking-wide text-navy-400 uppercase">Schedule</dt>
                      <dd className="mt-0.5 text-navy-900">
                        {c.scheduleImpactDays === 0
                          ? 'No change'
                          : `+${c.scheduleImpactDays} day${c.scheduleImpactDays === 1 ? '' : 's'}`}
                      </dd>
                      {c.revisedCompletionDate !== '' && (
                        <dd className="text-xs text-navy-400">
                          new finish {shortDate(c.revisedCompletionDate)}
                        </dd>
                      )}
                    </div>
                    <div>
                      <dt className="text-xs tracking-wide text-navy-400 uppercase">Payment</dt>
                      <dd className="mt-0.5 text-navy-900">{c.paymentRequirement}</dd>
                    </div>
                  </dl>

                  {c.clientComments !== '' && (
                    <p className="mt-3 border-l-2 border-navy-100 pl-3 text-sm text-navy-600 italic">
                      “{c.clientComments}”
                    </p>
                  )}

                  {c.status === 'Approved' && c.approvalDate !== '' && (
                    <p className="mt-3 text-xs text-navy-400">
                      Approved by {c.approvedBy} on {shortDate(c.approvalDate)}
                    </p>
                  )}

                  {c.status === 'Awaiting Client' && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                      >
                        Approve change order
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                      >
                        Ask a question
                      </button>
                      {c.approvalDeadline !== '' && (
                        <span className="text-xs text-navy-400">
                          by {shortDate(c.approvalDeadline)}
                        </span>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        Work your contractor absorbs at their own cost does not appear here — you are only shown
        changes that affect your price or your dates.
      </p>
    </div>
  );
}
