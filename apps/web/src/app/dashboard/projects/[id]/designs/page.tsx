import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { SELECTIONS } from '@/lib/data/portal-fixtures';
import { Badge, Card, InternalOnly, currency } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

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

  const selections = SELECTIONS.filter((s) => s.projectId === id);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Designs & Selections"
        subtitle="Set allowances, track real cost, release selections for the client to decide."
        clientHref={`/portal/designs?preview=${id}`}
        action={<ControlButton>New selection</ControlButton>}
      />

      <ControlNote>
        The client sees the allowance, any upgrade, and their own decision. The actual cost you pay
        is internal and never reaches them.
      </ControlNote>

      {selections.length === 0 ? (
        <ControlEmpty title="No selections yet" body="Add the first selection for this project." />
      ) : (
        <div className="space-y-3">
          {selections.map((s) => (
            <Card key={s.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-navy-900">{s.selectionName}</span>
                    <Badge tone={TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                    <VisibilityTag shown={project.clientPortalEnabled && s.clientVisible} />
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {s.category} · {s.roomOrArea} · {s.product} ({s.colorFinish})
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-navy-600 hover:underline"
                >
                  Edit
                </button>
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs tracking-wide text-navy-400 uppercase">Allowance</dt>
                  <dd className="tabular mt-0.5 font-medium text-navy-900">
                    {currency(s.allowance)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-navy-400 uppercase">Upgrade</dt>
                  <dd className="tabular mt-0.5 font-medium text-navy-900">
                    {currency(s.upgradeAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-navy-400 uppercase">
                    <InternalOnly>Actual cost</InternalOnly>
                  </dt>
                  <dd className="tabular mt-0.5 font-medium text-navy-900">
                    {currency(s.actualCost)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs tracking-wide text-navy-400 uppercase">Lead time</dt>
                  <dd className="mt-0.5 text-navy-900">{s.leadTime}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
