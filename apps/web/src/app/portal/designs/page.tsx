import { currentPortalProject, selectionsFor } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty, currency, shortDate } from '@/components/ui';

/**
 * Designs & Selections — §6.5, the client half.
 *
 * The homeowner sees the allowance, and the upgrade or credit against it. They
 * do not see `Actual Cost`: `selectionsFor` returns a type with no such
 * property, so this screen could not render it even by mistake.
 *
 * The three amounts shown are the §9.3 allow-list ones — Allowance, Upgrade,
 * Credit — and nothing else on the record is money.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Approved: 'good',
  Installed: 'good',
  Ordered: 'good',
  'Awaiting Client': 'warn',
  Rejected: 'warn',
};

export default async function PortalDesigns({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const selections = selectionsFor(project);
  const waiting = selections.filter((s) => s.status === 'Awaiting Client');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Designs &amp; Selections
        </h1>
        <p className="mt-1 text-sm text-navy-400">
          Review and approve materials, finishes, and layouts.
        </p>
      </div>

      {waiting.length > 0 && (
        <Card className="border-amber-accent/30 bg-amber-soft px-5 py-4">
          <div className="text-sm font-semibold text-navy-900">
            {waiting.length === 1
              ? 'One selection is waiting on you'
              : `${waiting.length} selections are waiting on you`}
          </div>
          <p className="mt-1 text-sm text-navy-600">
            Approving on time keeps the schedule where it is. The earliest deadline is{' '}
            {shortDate(
              waiting
                .map((s) => s.approvalDeadline)
                .filter((d) => d !== '')
                .sort()[0] ?? '',
            )}
            .
          </p>
        </Card>
      )}

      {selections.length === 0 ? (
        <PortalEmpty
          title="No selections shared yet"
          body="Your contractor hasn't published any material selections for this project."
        />
      ) : (
        <div className="space-y-4">
          {selections.map((s) => {
            const net = s.upgradeAmount - s.creditAmount;
            return (
              <Card key={s.id} className="px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-navy-900">{s.selectionName}</div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {s.category} · {s.roomOrArea}
                    </div>
                  </div>
                  <Badge tone={TONE[s.status] ?? 'neutral'}>{s.status}</Badge>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs tracking-wide text-navy-400 uppercase">Product</dt>
                    <dd className="mt-0.5 text-navy-900">
                      {s.manufacturer} {s.product}
                    </dd>
                    <dd className="text-xs text-navy-400">{s.colorFinish}</dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-navy-400 uppercase">Allowance</dt>
                    <dd className="tabular mt-0.5 text-navy-900">{currency(s.allowance)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs tracking-wide text-navy-400 uppercase">
                      {net < 0 ? 'Credit' : 'Upgrade'}
                    </dt>
                    <dd
                      className={`tabular mt-0.5 font-medium ${
                        net === 0 ? 'text-navy-400' : net < 0 ? 'text-green-700' : 'text-navy-900'
                      }`}
                    >
                      {net === 0 ? 'Within allowance' : currency(Math.abs(net))}
                    </dd>
                  </div>
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-400">
                  <span>Lead time {s.leadTime}</span>
                  {s.approvalDeadline !== '' && s.status === 'Awaiting Client' && (
                    <span>Decision needed by {shortDate(s.approvalDeadline)}</span>
                  )}
                  {s.approvedDate !== '' && <span>Approved {shortDate(s.approvedDate)}</span>}
                </div>

                {s.clientComments !== '' && (
                  <p className="mt-3 border-l-2 border-navy-100 pl-3 text-sm text-navy-600 italic">
                    “{s.clientComments}”
                  </p>
                )}

                {s.status === 'Awaiting Client' && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                    >
                      Approve selection
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Request a change
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        Amounts shown are your allowance and any upgrade or credit against it. What your contractor
        pays a supplier is not part of your contract and is never shown here.
      </p>
    </div>
  );
}
