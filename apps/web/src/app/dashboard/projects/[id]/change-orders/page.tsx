import { getHubSelections } from '@/lib/hub-db/selections';
import { ChangeOrdersManager } from '@/components/selections-manager';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { CHANGE_ORDERS } from '@/lib/data/portal-fixtures';
import { Badge, Card, currency, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

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

  const hub = getHubSelections();
  const rows = hub.available ? await hub.selections.listChangeOrders(scope, id) : [];
  const released = project.clientPortalEnabled;
  const waiting = rows.filter((c) => c.status === 'Awaiting Client').length;
  const drafts = rows.filter((c) => c.status === 'Draft').length;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Change Orders"
        subtitle="Draft a change, send it to the client, track their decision."
        clientHref={`/portal/change-orders?preview=${id}`}
      />

      <ControlNote>
        Sending a change order rings the client&rsquo;s bell — it appears in their header as waiting
        on them. {drafts > 0 ? `${drafts} draft${drafts === 1 ? '' : 's'} not yet sent. ` : ''}
        {waiting > 0
          ? `${waiting} awaiting the client's decision.`
          : 'Nothing is currently waiting on the client.'}
      </ControlNote>

      <ChangeOrdersManager
        projectId={id}
        orders={rows}
        released={released}
        hub={hub.available ? { available: true, missing: [] } : { available: false, missing: hub.missing }}
      />
    </div>
  );
}
