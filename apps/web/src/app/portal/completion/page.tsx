import { currentPortalProject, punchListFor } from '@/lib/portal-data';
import { punchItemDone, punchListProgress } from '@/lib/data/types';
import type { PunchListItem } from '@/lib/data/types';
import { Badge, Card, PortalEmpty, ProgressBar } from '@/components/ui';

/**
 * Artifact 90 Completion & Warranty — closeout, the punch list, and warranty
 * eligibility, as the client sees it.
 *
 * Two things this screen has to get right:
 *
 * **The punch list is shared, not handed down.** An item the homeowner raised on
 * a walkthrough is marked as theirs, so the list reads as a joint close-out
 * rather than a report the contractor files at them.
 *
 * **Warranty is eligibility language, never a promise.** Artifact 90 is explicit:
 * coverage is conditional on membership, project eligibility, documentation, an
 * agreement, and an admin review. Until that policy exists, this screen states
 * only that eligibility is confirmed at closeout — it never says a thing is
 * covered. That is a legal-weight boundary, not a styling choice.
 */

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusTone(status: PunchListItem['status']): 'good' | 'warn' | 'neutral' {
  if (status === 'Completed' || status === 'Verified') return 'good';
  if (status === 'Open') return 'warn';
  return 'neutral';
}

function statusLabel(status: PunchListItem['status']): string {
  if (status === 'Verified') return 'Verified';
  if (status === 'Completed') return 'Completed';
  if (status === 'Scheduled') return 'Scheduled';
  return 'Open';
}

function PunchCard({ item }: { item: PunchListItem }) {
  const done = punchItemDone(item);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold tracking-wide text-navy-400">
              PL-{item.itemNumber}
            </span>
            <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
            {item.raisedByClient && <Badge tone="neutral">You raised this</Badge>}
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-navy-900">{item.title}</h2>
          <p className="mt-0.5 text-xs text-navy-400">{item.location}</p>
        </div>
        <div className="text-right">
          <div className="text-xs tracking-wide text-navy-400 uppercase">
            {done ? 'Completed' : 'Target'}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-navy-900">
            {done
              ? item.completedDate === null
                ? '—'
                : longDate(item.completedDate)
              : item.targetDate === null
                ? '—'
                : longDate(item.targetDate)}
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

      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs tracking-wide text-navy-400 uppercase">Closeout progress</div>
            <div className="mt-1 text-sm text-navy-600">
              {progress.total === 0
                ? 'No outstanding punch list items.'
                : `${progress.done} of ${progress.total} items complete · ${progress.remaining} remaining`}
            </div>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-navy-900">
            {progress.percent}%
          </div>
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
        Warranty — eligibility-safe language ONLY (Artifact 90). Never states or
        implies coverage. No policy content is rendered because no policy is
        defined yet; this panel says only when and how eligibility is confirmed.
      */}
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-navy-900 uppercase">
          Warranty &amp; Alliance Protection
        </h2>
        <Card className="mt-3 p-5">
          <p className="text-sm leading-relaxed text-navy-700">
            Your warranty documentation and eligibility review become available at project closeout.
            Eligibility is confirmed by your contractor and depends on your membership, the project
            details, the documentation on file, and your agreement.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-navy-500">
            Nothing on this page confirms coverage. Once your project is complete and your
            eligibility review is done, the details will appear here.
          </p>
        </Card>
      </div>
    </div>
  );
}
