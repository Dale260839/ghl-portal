import { SubmitButton } from '@/components/submit-button';
import { getHubUpdateFeedback } from '@/lib/hub-db/update-feedback';
import { UpdateReply } from '@/components/update-reply';
import { UNLISTED_PROJECT } from '@/lib/project-codes';
import { reviewUpdate } from '@/lib/actions';

import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, CardHeader, InternalNote, shortDate } from '@/components/ui';
import { currentDataSource } from '@/lib/data/current-source';
import { pendingReviewCount } from '@/lib/field-review-policy';

/**
 * Daily Update Review (§12.1). The seven verbatim actions, and the one rule
 * that matters: `Internal Notes` and `Client Summary` are separate fields, and
 * only the second is ever a publish candidate (§10, §12.2).
 */
export default async function ReviewQueue() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [updates, projects] = await Promise.all([db.listDailyUpdates(scope), db.listProjects(scope)]);

  const queue = updates.filter(
    (u) => u.managerApprovalStatus === 'Pending' || u.managerApprovalStatus === 'Approved Internally',
  );
  const published = updates.filter((u) => u.managerApprovalStatus === 'Approved & Published');

  // Who read what, and what they said back. The ids come from a tenant-scoped
  // read, which is what makes this safe — see `hub-db/update-feedback.ts`.
  const feedbackStore = getHubUpdateFeedback();
  const feedback = feedbackStore.available
    ? await feedbackStore.feedback
        .forUpdates(published.map((u) => u.id))
        .catch(() => ({ acknowledgements: [], comments: [] }))
    : { acknowledgements: [], comments: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Field Updates</h1>
        <p className="mt-1 text-sm text-navy-400">
          {pendingReviewCount(updates)} awaiting review · nothing reaches the client until you publish it
        </p>
      </div>

      <div className="space-y-5">
        {queue.map((u) => {
          const project = projects.find((p) => p.buildsuiteProjectId === u.projectId);
          return (
            <Card key={u.id}>
              <CardHeader
                title={project?.projectName ?? UNLISTED_PROJECT}
                action={
                  <Badge tone={u.managerApprovalStatus === 'Pending' ? 'warn' : 'neutral'}>
                    {u.managerApprovalStatus}
                  </Badge>
                }
              />
              <div className="space-y-4 px-5 py-4">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
                  <span>{u.submittedBy}</span>
                  <span>{shortDate(u.updateDate)}</span>
                  <span>{u.crewOnsite} crew onsite</span>
                  <span>{u.hoursWorked} hrs</span>
                  <span>{u.weather}</span>
                </div>

                <div>
                  <div className="text-xs font-semibold tracking-wide text-navy-400 uppercase">
                    Work completed
                  </div>
                  <p className="mt-1 text-sm text-navy-700">{u.workCompleted}</p>
                </div>

                <InternalNote
                  label="Internal field notes"
                  footnote="Cannot be published. Not readable from any client-facing response."
                >
                  {u.internalNotes}
                </InternalNote>

                <form action={reviewUpdate} className="space-y-3">
                  <input type="hidden" name="updateId" value={u.id} />
                  <div>
                    <label
                      htmlFor={`summary-${u.id}`}
                      className="text-xs font-semibold tracking-wide text-navy-400 uppercase"
                    >
                      Client summary — editable before publishing
                    </label>
                    <textarea
                      id={`summary-${u.id}`}
                      name="clientSummary"
                      rows={3}
                      defaultValue={u.clientSummary}
                      className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 focus:border-navy-600 focus:ring-1 focus:ring-navy-600 focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <SubmitButton
                      name="action"
                      value="publish"
                      className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
                    >
                      Approve and Publish
                    </SubmitButton>
                    <SubmitButton
                      name="action"
                      value="internal"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Approve Internally
                    </SubmitButton>
                    <SubmitButton
                      name="action"
                      value="save"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Edit Client Summary
                    </SubmitButton>
                    <SubmitButton
                      name="action"
                      value="return"
                      className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
                    >
                      Return for Revision
                    </SubmitButton>
                  </div>
                </form>
              </div>
            </Card>
          );
        })}

        {queue.length === 0 && (
          <Card className="px-5 py-12 text-center text-sm text-navy-400">
            Review queue is clear.
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Published to clients" />
        <ul className="divide-y divide-navy-100">
          {published.map((u) => {
            const project = projects.find((p) => p.buildsuiteProjectId === u.projectId);
            return (
              <li key={u.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-navy-900">
                    {project?.projectName ?? UNLISTED_PROJECT}
                  </span>
                  <span className="text-xs text-navy-400">
                    published {u.publishDate === null ? '—' : shortDate(u.publishDate)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-navy-600">{u.clientSummary}</p>

                {(() => {
                  const reads = feedback.acknowledgements.filter((a) => a.updateId === u.id);
                  const said = feedback.comments.filter((c) => c.updateId === u.id);
                  return (
                    <>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {reads.length > 0 ? (
                          <Badge tone="good">
                            Read by {reads.map((a) => a.acknowledgedBy).join(', ')}
                          </Badge>
                        ) : (
                          // Publishing used to be shouting into a room with the
                          // lights off. Saying "not opened yet" is the whole
                          // value of the acknowledgement.
                          <span className="text-xs text-navy-400">Not marked as read yet</span>
                        )}
                        {said.length > 0 && (
                          <span className="text-xs text-navy-500">
                            {said.length} {said.length === 1 ? 'reply' : 'replies'}
                          </span>
                        )}
                      </div>

                      {said.length > 0 && (
                        <ul className="mt-2 space-y-2 border-l-2 border-navy-100 pl-3">
                          {said.map((c) => (
                            <li key={c.id} className="text-sm">
                              <span className="font-medium text-navy-900">{c.author}</span>{' '}
                              <span className="text-xs text-navy-400">
                                {c.authorRole === 'client' ? 'homeowner' : 'your team'} ·{' '}
                                {shortDate(c.createdAt)}
                              </span>
                              {!c.clientVisible && (
                                <span className="ml-1.5 text-[10px] font-semibold tracking-wide text-amber-accent uppercase">
                                  Internal
                                </span>
                              )}
                              <p className="mt-0.5 leading-relaxed text-navy-700">{c.body}</p>
                            </li>
                          ))}
                        </ul>
                      )}

                      <UpdateReply updateId={u.id} />
                    </>
                  );
                })()}
              </li>
            );
          })}
          {published.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-navy-400">Nothing published yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
