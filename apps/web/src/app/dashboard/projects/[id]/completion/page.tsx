import { notFound } from 'next/navigation';

import { SubmitButton } from '@/components/submit-button';
import { NotLinkedToContractor } from '@/components/not-linked';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import {
  getHubOperational,
  isPunchItem,
  PUNCH_STATUSES,
  punchItemFromIssue,
} from '@/lib/hub-db/operational';
import { addPunchItem, releasePunchItem, setPunchStatus } from '@/lib/actions/issues';
import { punchListProgress } from '@/lib/data/types';
import { Badge, Card, CardHeader, InternalNote, ProgressBar, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Completion & Warranty — the contractor's control side, and now a real one.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED
 *
 * This screen listed `PUNCH_LIST` from a fixture file behind an "Add punch
 * item" button with no handler. It now reads and writes `hub_issues` under the
 * `Punch List` category, which is the same list the crew works from on their
 * phones.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO PUNCH LIST TABLE
 *
 * A snag is an issue with a narrower vocabulary — Open, Scheduled, Completed,
 * Verified rather than Open, In Progress, Resolved, Closed. Those are the same
 * four states with the words a site manager uses, so they share one table, one
 * tenant filter, one archive path and one release switch. Two tables would be
 * the same rules written twice, and the second copy is the one that drifts.
 *
 * `punchItemFromIssue` in `operational.ts` does the translation, in one place.
 *
 * The warranty half of this screen is not built. There is no warranty data in
 * the Hub yet and inventing some would be worse than an honest gap.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Verified: 'good',
  Completed: 'good',
  Scheduled: 'warn',
  Open: 'neutral',
};

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

export default async function ProjectCompletionControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="The punch list" />;
  }

  const hub = getHubOperational();
  const rows = hub.available ? await hub.ops.listIssues(scope, id) : [];
  const items = rows
    .filter(isPunchItem)
    .map(punchItemFromIssue)
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
  const progress = punchListProgress(items);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Completion & Warranty"
        subtitle="Close out the punch list. Release the items the client should track."
        clientHref={`/portal/completion?preview=${id}`}
      />

      {!hub.available ? (
        <ControlNote>
          The Hub database is not connected, so the punch list cannot be read or saved. Missing:{' '}
          {hub.missing.join(', ')}.
        </ControlNote>
      ) : (
        <ControlNote>
          Work the list down to zero. Your crew can take an item as far as Completed on their
          phones; Verified is yours, because somebody other than the person who did the work has to
          look. The internal note on each item never reaches the client.
        </ControlNote>
      )}

      {hub.available && (
        <Card>
          <CardHeader title="Add punch item" />
          <form action={addPunchItem} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
            <input type="hidden" name="projectId" value={id} />
            <input
              name="title"
              required
              placeholder="What needs finishing, e.g. Touch up paint"
              className={`${FIELD} sm:col-span-2`}
            />
            <input name="location" placeholder="Location, e.g. Kitchen" className={FIELD} />
            <label className="text-xs text-navy-500">
              Target
              <input type="date" name="targetDate" className={`${FIELD} mt-1 w-full`} />
            </label>

            <textarea
              name="description"
              rows={2}
              placeholder="What has to happen"
              className={`${FIELD} sm:col-span-4`}
            />
            <textarea
              name="internalNotes"
              rows={2}
              placeholder="Internal notes for your team"
              className={`${FIELD} sm:col-span-4`}
            />

            <div className="flex items-center justify-between gap-3 sm:col-span-4">
              <p className="text-xs text-navy-400">
                Saved as internal. Release it to the client with the switch on the item.
              </p>
              <SubmitButton className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700">
                Add item
              </SubmitButton>
            </div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <ControlEmpty title="No punch list" body="Closeout items for this project will land here." />
      ) : (
        <>
          <Card className="px-5 py-5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-navy-900">Closeout progress</span>
              <span className="tabular text-navy-500">
                {progress.done} of {progress.total} done · {progress.remaining} left
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar value={progress.percent} />
            </div>
          </Card>

          <div className="space-y-3">
            {items.map((p) => (
              <Card key={p.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-navy-900">
                    {p.itemNumber} · {p.title}
                  </span>
                  <Badge tone={TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                  {p.raisedByClient && <Badge tone="warn">Client raised</Badge>}
                  <VisibilityTag shown={project.clientPortalEnabled && p.clientVisible} />
                </div>
                <div className="mt-0.5 text-xs text-navy-400">
                  {p.location || 'No location'} · raised by {p.reportedBy || 'unknown'}
                  {p.targetDate !== '' ? ` · target ${shortDate(p.targetDate)}` : ''}
                  {p.completedDate !== '' ? ` · done ${shortDate(p.completedDate)}` : ''}
                </div>

                {p.description !== '' && (
                  <p className="mt-2.5 text-sm leading-relaxed text-navy-600">{p.description}</p>
                )}

                {p.internalNotes !== '' && (
                  <div className="mt-2.5">
                    <InternalNote label="Internal notes" size="xs">
                      {p.internalNotes}
                    </InternalNote>
                  </div>
                )}

                {/* One button per state rather than a select and a save. A
                    closeout list is worked in single taps, and a two-step
                    control is the one people forget to finish. */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {PUNCH_STATUSES.map((s) => (
                    <form key={s} action={setPunchStatus}>
                      <input type="hidden" name="issueId" value={p.id} />
                      <input type="hidden" name="projectId" value={id} />
                      <input type="hidden" name="status" value={s} />
                      <SubmitButton
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                          p.status === s
                            ? 'border-navy-900 bg-navy-900 text-white'
                            : 'border-navy-200 text-navy-700 hover:bg-navy-50'
                        }`}
                      >
                        {s}
                      </SubmitButton>
                    </form>
                  ))}
                </div>

                <form
                  action={releasePunchItem}
                  className="mt-3 flex flex-wrap items-center gap-4 border-t border-navy-100 pt-3"
                >
                  <input type="hidden" name="issueId" value={p.id} />
                  <input type="hidden" name="projectId" value={id} />
                  <label className="flex items-center gap-2 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={p.clientVisible}
                      className="rounded border-navy-300"
                    />
                    Show this item to the client
                  </label>
                  <SubmitButton className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
                    Save
                  </SubmitButton>
                </form>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
