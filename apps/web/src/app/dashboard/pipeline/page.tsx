import { getDealsReader } from '@/lib/buildsuite/deals';
import { getSession } from '@/lib/session';
import { buildPipelineView, pipelineHeadline, type AgeBand } from '@/lib/pipeline-view';
import { Badge, Card, CardHeader, StatTile } from '@/components/ui';

/**
 * The pipeline — BuildSuite's deal funnel for this contractor.
 *
 * This screen exists because of one measurement. Across 182 deals: 5 matched to
 * a contractor, 2 handed to GoHighLevel, **none signed**. For Alliance, 23 deals
 * and none matched. Until now that was only visible by running SQL, so the
 * people who can fix it could not see the thing they need to fix.
 *
 * **Live only, and deliberately not on the demo toggle.** Every other dashboard
 * screen swaps to fixtures when the toggle is on, because fixtures make the
 * walkthrough coherent. Here that would defeat the point: an invented funnel
 * with invented signatures is exactly the reassuring picture the real data
 * contradicts. Same choice `/dashboard/buildsuite` makes.
 */

const BAND_STYLE: Record<AgeBand, { row: string; text: string; label: string }> = {
  fresh: { row: '', text: 'text-navy-400', label: '' },
  stalled: {
    row: 'border-l-2 border-l-amber-accent',
    text: 'text-amber-700',
    label: 'Stalled',
  },
  dormant: {
    row: 'border-l-2 border-l-red-400',
    text: 'text-red-700',
    label: 'Dormant',
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold tracking-tight text-navy-900">Pipeline</h1>
      {children}
    </div>
  );
}

function Notice({ title, detail, tone }: { title: string; detail: string; tone?: 'bad' }) {
  return (
    <Card className="px-5 py-10 text-center">
      <p className={`text-sm ${tone === 'bad' ? 'font-medium text-red-700' : 'text-navy-600'}`}>
        {title}
      </p>
      <p className="mt-1.5 text-xs text-navy-400">{detail}</p>
    </Card>
  );
}

export default async function Pipeline() {
  const session = await getSession();

  // Tenancy first. `deals` carries client names and budgets for every
  // contractor, so an unscoped read here is the leak this guard exists to stop.
  if (session?.authProfileIds === undefined || session.authProfileIds.length === 0) {
    return (
      <Shell>
        <Notice
          title="This account isn't linked to a BuildSuite profile."
          detail="Deals are scoped per contractor, so there is nothing to show."
        />
      </Shell>
    );
  }

  const reader = getDealsReader();
  if (!reader.available) {
    return (
      <Shell>
        <Notice title="Not connected to BuildSuite." detail={`Missing: ${reader.missing.join(', ')}`} />
      </Shell>
    );
  }

  const scope = {
    locationId: session.ghlLocationId ?? '',
    authProfileIds: session.authProfileIds,
  };

  let view;
  try {
    const [deals, funnel] = await Promise.all([
      reader.listDeals(scope, 200),
      reader.dealFunnel(scope),
    ]);
    view = buildPipelineView(deals, funnel, new Date());
  } catch (error) {
    // Reported, never papered over with samples — a screen that quietly swaps
    // live data for fixtures is worse than one that errors.
    return (
      <Shell>
        <Notice
          tone="bad"
          title="Couldn't read the deal pipeline."
          detail={error instanceof Error ? error.message : 'Unknown error'}
        />
      </Shell>
    );
  }

  const milestones = view.milestones;

  return (
    <div className="space-y-7">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">Pipeline</h1>
          <Badge tone="good">Live data</Badge>
        </div>
        <p className="mt-1 text-sm text-navy-400">{pipelineHeadline(view)}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Deals" value={String(view.total)} />
        <StatTile
          label="Stalled"
          value={String(view.aging.stalled)}
          sub="14+ days without movement"
          tone={view.aging.stalled > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Dormant"
          value={String(view.aging.dormant)}
          sub="60+ days without movement"
          tone={view.aging.dormant > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Oldest"
          value={view.total === 0 ? '—' : `${view.oldestDays}d`}
          sub="since last movement"
          tone={view.oldestDays >= 60 ? 'warn' : 'default'}
        />
      </div>

      <Card>
        <CardHeader
          title="Where deals are now"
          action={<span className="text-xs text-navy-400">current stage, not cumulative</span>}
        />
        <div className="space-y-3 px-5 py-4">
          {view.bars.map((bar) => (
            <div key={bar.stage} className="flex items-center gap-4">
              <div className="w-44 shrink-0 text-xs text-navy-600">
                {bar.label}
                {!bar.known && (
                  <span className="ml-1.5 text-[10px] text-amber-700">new</span>
                )}
              </div>
              <div className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-navy-100/60">
                <div
                  className={`h-full rounded ${bar.known ? 'bg-navy-600' : 'bg-amber-accent'}`}
                  style={{ width: `${bar.width}%` }}
                />
              </div>
              <div className="tabular w-8 shrink-0 text-right text-sm font-medium text-navy-900">
                {bar.count}
              </div>
            </div>
          ))}
        </div>
        <p className="border-t border-navy-100 px-5 py-3 text-xs leading-relaxed text-navy-400">
          These are the stages BuildSuite records on a deal. They show where each deal sits
          today, not how many ever passed through — a deal that advances leaves the count it
          came from.
        </p>
      </Card>

      <Card>
        <CardHeader title="How far the pipeline gets" />
        <ul className="divide-y divide-navy-100">
          {milestones.map((milestone) => (
            <li key={milestone.key} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-sm text-navy-900">{milestone.label}</div>
                {milestone.note !== null && (
                  <div className="mt-0.5 text-xs text-navy-400">{milestone.note}</div>
                )}
              </div>
              <div
                className={`tabular shrink-0 text-lg font-semibold ${
                  milestone.count === 0 ? 'text-red-600' : 'text-navy-900'
                }`}
              >
                {milestone.count}
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-navy-100 px-5 py-3 text-xs leading-relaxed text-navy-400">
          These cut across the stages rather than being one, so they are counted separately —
          a signed deal still carries whatever status it had.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Deals"
          action={<span className="text-xs text-navy-400">oldest first</span>}
        />
        <ul className="divide-y divide-navy-100">
          {view.rows.map((row) => {
            const band = BAND_STYLE[row.band];
            return (
              <li key={row.id} className={`px-5 py-4 ${band.row}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-navy-900">
                      {row.clientName}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-400">
                      {row.projectType !== '' && <span>{row.projectType}</span>}
                      {row.budgetRange !== '' && <span className="tabular">{row.budgetRange}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge>{row.stageLabel}</Badge>
                    {row.matched && <Badge tone="good">Matched</Badge>}
                    {row.signed && <Badge tone="good">Signed</Badge>}
                    {row.linkedToProject ? (
                      <Badge tone="neutral">Has project</Badge>
                    ) : (
                      <Badge tone="warn">No project yet</Badge>
                    )}
                  </div>
                </div>
                <div className={`mt-2 text-xs ${band.text}`}>
                  {band.label !== '' && <span className="font-medium">{band.label} · </span>}
                  no movement in {row.days} {row.days === 1 ? 'day' : 'days'}
                </div>
              </li>
            );
          })}
          {view.rows.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-navy-400">
              No deals for this contractor in BuildSuite.
            </li>
          )}
        </ul>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        <strong className="font-semibold text-navy-600">On the coverage.</strong>{' '}
        {view.coverageNote} Age is measured from the last write to the deal, which is the closest
        signal available — BuildSuite keeps no stage history, so a deal edited for an unrelated
        reason reads as having moved.
      </p>
    </div>
  );
}
