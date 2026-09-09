import { NotLinkedToContractor } from '@/components/not-linked';
import { getHubSelections } from '@/lib/hub-db/selections';
import { SelectionsManager } from '@/components/selections-manager';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { SELECTIONS } from '@/lib/data/portal-fixtures';
import { Badge, Card, InternalOnly, currency } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Approved: 'good',
  Installed: 'good',
  Ordered: 'good',
  'Awaiting Client': 'warn',
  Pending: 'neutral',
  Rejected: 'warn',
};

/**
 * Designs & Selections — contractor control side. The contractor sets the
 * allowance and tracks the real cost; the client sees the allowance, the
 * upgrade, and their decision — never `actualCost`, which is dropped by
 * construction on the client side and shown here as internal.
 */
export default async function ProjectDesignsControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  // Nine of the sixty-eight accounts on this location do not resolve to a
  // contractor record, and everything the Hub stores is filed under one. Say
  // so rather than throwing: `assertContractor` is right to refuse, but a
  // TenancyError on screen tells the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Selections" />;
  }

  const hub = getHubSelections();
  const rows = hub.available ? await hub.selections.listSelections(scope, id) : [];
  const released = project.clientPortalEnabled;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Designs & Selections"
        subtitle="Set allowances, track real cost, release selections for the client to decide."
        clientHref={`/portal/designs?preview=${id}`}
      />

      <ControlNote>
        The client sees the allowance, any upgrade, and their own decision. The actual cost you pay
        is internal and never reaches them.
      </ControlNote>

      <SelectionsManager
        projectId={id}
        selections={rows}
        released={released}
        hub={hub.available ? { available: true, missing: [] } : { available: false, missing: hub.missing }}
      />
    </div>
  );
}
