import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { CHANGE_ORDERS } from '@/lib/data/portal-fixtures';
import { Badge, Card, currency, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

const TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = {
  Approved: 'good',
  'Awaiting Client': 'warn',
  Rejected: 'bad',
  Draft: 'neutral',
};

/**
 * Change Orders — contractor control side, and the source of the client's bell.
 *
 * The contractor drafts a change order here and sends it; sending flips it to
 * "Awaiting Client", which is what the bell in the client header counts. When
 * the client approves, WF6 moves the contract total. Absorbed change orders —
 * the contractor's own cost, not billed on — are visible here and never on the
 * client side, so this list is longer than theirs on purpose.
 */
export default async function ProjectChangeOrdersControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const orders = CHANGE_ORDERS.filter((c) => c.projectId === id).sort((a, b) =>
    b.createdDate.localeCompare(a.createdDate),
  );
  const waiting = orders.filter((c) => c.status === 'Awaiting Client').length;
  const drafts = orders.filter((c) => c.status === 'Draft').length;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Change Orders"
        subtitle="Draft a change, send it to the client, track their decision."
        clientHref={`/portal/change-orders?preview=${id}`}
        action={<ControlButton>New change order</ControlButton>}
      />

      <ControlNote>
        Sending a change order rings the client&rsquo;s bell — it appears in their header as waiting
        on them. {drafts > 0 ? `${drafts} draft${drafts === 1 ? '' : 's'} not yet sent. ` : ''}
        {waiting > 0
          ? `${waiting} awaiting the client's decision.`
          : 'Nothing is currently waiting on the client.'}
      </ControlNote>

      {orders.length === 0 ? (
        <ControlEmpty title="No change orders" body="Nothing has changed from the original scope." />
      ) : (
        <div className="space-y-3">
          {orders.map((c) => {
            const net = c.addedCost + c.tax - c.creditAmount;
            return (
              <Card key={c.id} className="px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-navy-900">
                        {c.changeOrderNumber} · {c.title}
                      </span>
                      <Badge tone={TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                      <VisibilityTag shown={project.clientPortalEnabled && c.clientVisible} />
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      Requested by {c.requestedBy} on {shortDate(c.createdDate)}
                    </div>
                  </div>
                  <div className="tabular shrink-0 text-right text-sm font-semibold text-navy-900">
                    {net < 0 ? `(${currency(Math.abs(net))})` : currency(net)}
                    <div className="text-xs font-normal text-navy-400">
                      {net < 0 ? 'credit' : 'added to contract'}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-navy-600">{c.description}</p>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-navy-400">
                  <span>
                    Schedule:{' '}
                    {c.scheduleImpactDays === 0
                      ? 'no change'
                      : `+${c.scheduleImpactDays} day${c.scheduleImpactDays === 1 ? '' : 's'}`}
                  </span>
                  <span>Payment: {c.paymentRequirement}</span>
                  {c.reason !== '' && <span>Reason: {c.reason}</span>}
                </div>

                {c.status === 'Draft' && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <ControlButton>Send to client</ControlButton>
                    <button
                      type="button"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Edit draft
                    </button>
                  </div>
                )}
                {c.status === 'Awaiting Client' && (
                  <p className="mt-3 text-xs text-amber-700">
                    Sent to the client{c.approvalDeadline !== '' ? ` · reply by ${shortDate(c.approvalDeadline)}` : ''} — showing in their bell.
                  </p>
                )}
                {c.status === 'Approved' && c.approvalDate !== '' && (
                  <p className="mt-3 text-xs text-navy-400">
                    Approved by {c.approvedBy} on {shortDate(c.approvalDate)}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
