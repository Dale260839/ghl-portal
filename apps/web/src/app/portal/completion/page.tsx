import { currentPortalProject, punchListFor } from '@/lib/portal-data';
import type { ClientPunchItem } from '@/lib/portal-data';
import { punchItemDone, punchListProgress } from '@/lib/data/types';
import { DEFAULT_WARRANTY_MONTHS } from '@/lib/workflows/wf8-project-completed';
import { Badge, Card, PortalEmpty, ProgressBar, shortDate } from '@/components/ui';

/**
 * §6.9 / Artifact 90 Completion & Warranty — closeout, the punch list, and
 * warranty, as the client sees it.
 *
 * Two things this screen has to get right:
 *
 * **The punch list is shared, not handed down.** An item the homeowner raised on
 * a walkthrough is marked as theirs, so the list reads as a joint close-out
 * rather than a report the contractor files at them. `punchListFor` drops
 * `internalNotes` by construction, so nothing internal can reach this screen.
 *
 * **Warranty is split, and only one half carries dates.** The *workmanship*
 * warranty is a factual term (WF8's duration), stated as beginning at closeout.
 * *Alliance Protection* is a membership program, and Artifact 90 is explicit:
 * never state or imply coverage — eligibility is confirmed at closeout, subject
 * to membership, the project, and an agreement. That is a legal-weight boundary,
 * not a styling choice, so this screen promises nothing.
 */

const TONE: Record<ClientPunchItem['status'], 'good' | 'warn' | 'neutral'> = {
  Verified: 'good',
  Completed: 'good',
  Scheduled: 'neutral',
  Open: 'warn',
};

function PunchCard({ item }: { item: ClientPunchItem }) {
  const done = punchItemDone(item);
  const dateLabel = done ? 'Completed' : 'Target';
  const dateValue = done ? item.completedDate : item.targetDate;

  return (
    <Card className="px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold tracking-wide text-navy-400">
              PL-{item.itemNumber}
            </span>
            <Badge tone={TONE[item.status]}>{item.status}</Badge>
            {item.raisedByClient && <Badge tone="neutral">You raised this</Badge>}
          </div>
          <div className="mt-1.5 text-sm font-semibold text-navy-900">{item.title}</div>
          <div className="mt-0.5 text-xs text-navy-400">{item.location}</div>
        </div>
        <div className="text-right">
          <div className="text-xs tracking-wide text-navy-400 uppercase">{dateLabel}</div>
          <div className="mt-0.5 text-sm font-medium text-navy-900">
            {dateValue === '' ? '—' : shortDate(dateValue)}
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-navy-700">{item.description}</p>
    </Card>
  );
}

export default async function PortalCompletion({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const items = punchListFor(project);
  const progress = punchListProgress(items);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Completion &amp; Warranty
        </h1>
        <p className="mt-1 text-sm text-navy-400">
          Closeout progress, the punch list, and your warranty information.
        </p>
      </div>

      <Card className="px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs tracking-wide text-navy-400 uppercase">Closeout progress</div>
            <div className="mt-1 text-sm text-navy-600">
              {progress.total === 0
                ? 'No outstanding punch list items.'
                : `${progress.done} of ${progress.total} items complete · ${progress.remaining} remaining`}
            </div>
          </div>
          <div className="tabular text-2xl font-semibold text-navy-900">{progress.percent}%</div>
        </div>
        <div className="mt-3">
          <ProgressBar value={progress.percent} label={false} />
        </div>
      </Card>

      <div>
        <h2 className="text-sm font-semibold tracking-wide text-navy-900 uppercase">Punch list</h2>
        {items.length === 0 ? (
          <div className="mt-3">
            <PortalEmpty
              title="Nothing outstanding"
              body="Any final touch-ups agreed during your walkthrough will appear here, with their status as your team completes them."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {items.map((item) => (
              <PunchCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/*
        Warranty — split into the workmanship term (factual, dated at closeout)
        and Alliance Protection (eligibility-safe only, Artifact 90). Neither
        states coverage, and no policy content is invented — none exists yet.
      */}
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-navy-900 uppercase">
          Warranty &amp; Alliance Protection
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Card className="px-5 py-5">
            <div className="text-sm font-semibold text-navy-900">Workmanship warranty</div>
            <p className="mt-2 text-sm leading-relaxed text-navy-700">
              Your {DEFAULT_WARRANTY_MONTHS}-month workmanship warranty begins when your project is
              marked complete. The exact dates will appear here at closeout, alongside your final
              documents.
            </p>
          </Card>
          <Card className="px-5 py-5">
            <div className="text-sm font-semibold text-navy-900">Alliance Protection</div>
            <p className="mt-2 text-sm leading-relaxed text-navy-700">
              Eligibility is confirmed by your contractor at closeout, based on your membership, the
              project details, and your agreement.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-navy-500">
              Nothing here confirms coverage. Once your project is complete and your eligibility
              review is done, the details will appear here.
            </p>
          </Card>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-navy-400">
          Warranty documents your contractor has shared appear on the Documents screen.
        </p>
      </div>
    </div>
  );
}
