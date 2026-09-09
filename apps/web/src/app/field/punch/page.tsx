import { SubmitButton } from '@/components/submit-button';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { getHubOperational, isPunchItem, punchItemFromIssue } from '@/lib/hub-db/operational';
import { addPunchItem, setPunchStatus } from '@/lib/actions/issues';
import { punchListProgress } from '@/lib/data/types';
import { Badge, Card, CardHeader, ProgressBar, shortDate } from '@/components/ui';

/**
 * The punch list, on site (D4 §5).
 *
 * ---------------------------------------------------------------------------
 * SCHEDULED AND COMPLETED, NEVER VERIFIED
 *
 * A crew member takes a snag as far as Completed. **Verified is the office's
 * word.** A role that can verify its own work is not a check on it — the whole
 * reason the fourth state exists is that somebody other than the person holding
 * the brush looked at it.
 *
 * That is enforced in `setPunchStatus`, not merely by leaving the button off
 * this page. A server action is something anyone can post to.
 *
 * There is no release control here either. Whether a homeowner tracks an item
 * is the contractor's decision, made on the Completion & Warranty screen.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Verified: 'good',
  Completed: 'good',
  Scheduled: 'warn',
  Open: 'neutral',
};

const FIELD = 'w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm';

/** What a crew member may move an item to, given where it is now. */
const NEXT: Record<string, readonly ('Scheduled' | 'Completed')[]> = {
  Open: ['Scheduled', 'Completed'],
  Scheduled: ['Completed'],
  Completed: ['Scheduled'],
  // Verified is finished. Nothing on this screen reopens the office's sign-off.
  Verified: [],
};

export default async function FieldPunchList() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  // A session that resolves to no contractor record has nothing to read: every
  // Hub row is filed under one, and `assertContractor` rightly throws rather
  // than falling back to another id. Say so plainly — a stack trace tells a
  // person on a job site nothing they can act on.
  if (scope.contractorId === undefined) {
    return (
      <Card className="px-4 py-8 text-center">
        <p className="text-sm text-navy-400">
          Your account is not linked to a company yet. Ask your PM to check your invitation.
        </p>
      </Card>
    );
  }

  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(await requireAccess(), projects, tasks);
  const ids = new Set(mine.map((p) => p.buildsuiteProjectId));

  const hub = getHubOperational();
  const rows = hub.available ? await hub.ops.listIssues(scope) : [];
  const items = rows
    .filter((i) => ids.has(i.projectId) && isPunchItem(i))
    .map(punchItemFromIssue)
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
  const progress = punchListProgress(items);

  const nameOf = (projectId: string) =>
    mine.find((p) => p.buildsuiteProjectId === projectId)?.projectName ?? projectId;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Punch list</h1>
        <p className="mt-1 text-sm text-navy-400">
          {items.length === 0
            ? 'Nothing on your closeout list'
            : `${progress.remaining} of ${progress.total} still to do`}
        </p>
      </div>

      {!hub.available ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            The punch list is not available right now. Ask your PM to check the connection.
          </p>
        </Card>
      ) : (
        <>
          {items.length > 0 && (
            <Card className="px-4 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-navy-900">Closeout progress</span>
                <span className="tabular text-navy-500">{progress.percent}%</span>
              </div>
              <div className="mt-3">
                <ProgressBar value={progress.percent} label={false} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Add an item" />
            <form action={addPunchItem} className="space-y-3 px-4 py-4">
              <div>
                <label htmlFor="projectId" className="text-xs font-medium text-navy-600">
                  Project
                </label>
                <select id="projectId" name="projectId" className={`${FIELD} mt-1.5 bg-white`}>
                  {mine.map((p) => (
                    <option key={p.buildsuiteProjectId} value={p.buildsuiteProjectId}>
                      {p.projectName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="title" className="text-xs font-medium text-navy-600">
                  What needs finishing
                </label>
                <input id="title" name="title" required className={`${FIELD} mt-1.5`} />
              </div>

              <div>
                <label htmlFor="location" className="text-xs font-medium text-navy-600">
                  Location
                </label>
                <input
                  id="location"
                  name="location"
                  placeholder="e.g. Kitchen"
                  className={`${FIELD} mt-1.5`}
                />
              </div>

              <div>
                <label htmlFor="description" className="text-xs font-medium text-navy-600">
                  Detail
                </label>
                <textarea id="description" name="description" rows={2} className={`${FIELD} mt-1.5`} />
              </div>

              <SubmitButton className="min-h-11 w-full rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-800">
                Add item
              </SubmitButton>
            </form>
          </Card>

          {items.length === 0 ? (
            <Card className="px-4 py-8 text-center">
              <p className="text-sm text-navy-400">
                Nothing on the closeout list for your projects yet.
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {items.map((p) => (
                <li key={p.id}>
                  <Card className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-navy-900">
                          {p.itemNumber} · {p.title}
                        </span>
                        <div className="mt-0.5 text-xs text-navy-400">
                          {nameOf(p.projectId)}
                          {p.location !== '' && ` · ${p.location}`}
                          {p.targetDate !== '' && ` · target ${shortDate(p.targetDate)}`}
                        </div>
                      </div>
                      <Badge tone={TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                    </div>

                    {p.description !== '' && (
                      <p className="mt-3 text-sm leading-relaxed text-navy-700">{p.description}</p>
                    )}

                    {p.internalNotes !== '' && (
                      <div className="mt-3 rounded-md border-l-2 border-navy-900 bg-navy-50 px-3 py-2.5">
                        <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                          Notes from the office
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-navy-700">
                          {p.internalNotes}
                        </p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {NEXT[p.status]?.map((s) => (
                        <form key={s} action={setPunchStatus}>
                          <input type="hidden" name="issueId" value={p.id} />
                          <input type="hidden" name="projectId" value={p.projectId} />
                          <input type="hidden" name="status" value={s} />
                          <SubmitButton className="min-h-10 rounded-lg border border-navy-200 px-3.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50">
                            {s === 'Scheduled' ? 'Schedule it' : 'Mark completed'}
                          </SubmitButton>
                        </form>
                      ))}
                      {p.status === 'Completed' && (
                        <span className="self-center text-xs text-navy-400">
                          Waiting on the office to verify
                        </span>
                      )}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        You can take an item as far as Completed. Verified is signed off by the office.
      </p>
    </div>
  );
}
