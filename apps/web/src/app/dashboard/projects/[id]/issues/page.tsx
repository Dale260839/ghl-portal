import { notFound } from 'next/navigation';
import { ISSUE_CATEGORIES } from '@buildsuite/contracts';

import { SubmitButton } from '@/components/submit-button';
import { NotLinkedToContractor } from '@/components/not-linked';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubOperational, isPunchItem, ISSUE_STATUSES } from '@/lib/hub-db/operational';
import { archiveIssue, raiseIssue, releaseIssue, updateIssueStatus } from '@/lib/actions/issues';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Issues — the contractor's control side, and now a real one.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED
 *
 * This screen listed `ISSUES` from a fixture file behind a "Log issue" button
 * with no handler. It looked finished and did nothing. It now reads and writes
 * `hub_issues`, which the crew's own screens write into.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT SEES
 *
 * Two things together, and the tag on each row says which: the project's portal
 * switch, and `client_visible` on the row. An issue is internal until someone
 * releases it, and releasing asks for the client-facing line at the same time —
 * an issue with nothing written for the homeowner is one nobody has decided
 * what to tell them about yet.
 *
 * The internal note and the assignee never travel. `ClientIssue` in
 * `portal-gates.ts` has no such properties, so the portal could not render them
 * if it tried.
 *
 * Punch list items live in this same table under the `Punch List` category and
 * are excluded here — they have their own screen under Completion & Warranty.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = {
  Resolved: 'good',
  Closed: 'good',
  'In Progress': 'warn',
  Assigned: 'warn',
  Open: 'bad',
};

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

export default async function ProjectIssuesControl({
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
  // contractor record, and everything the Hub stores is filed under one. Say so
  // rather than throwing: `assertContractor` is right to refuse, but a
  // TenancyError on screen tells the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Issues" />;
  }

  const hub = getHubOperational();
  const all = hub.available ? await hub.ops.listIssues(scope, id) : [];
  const issues = all
    .filter((i) => !isPunchItem(i))
    .sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Issues"
        subtitle="Track every issue. Release the ones the homeowner should know about."
        clientHref={`/portal/issues?preview=${id}`}
      />

      {!hub.available ? (
        <ControlNote>
          The Hub database is not connected, so issues cannot be read or saved. Missing:{' '}
          {hub.missing.join(', ')}.
        </ControlNote>
      ) : (
        <ControlNote>
          {project.clientPortalEnabled ? (
            <>
              This client&rsquo;s portal is{' '}
              <strong className="font-semibold text-navy-900">open</strong>. They still see only the
              issues you release, with the client update you wrote. The internal note and the
              assignee stay here.
            </>
          ) : (
            <>
              This client&rsquo;s portal is{' '}
              <strong className="font-semibold text-navy-900">closed</strong>, so nothing on this
              page reaches them, released or not.
            </>
          )}
        </ControlNote>
      )}

      {hub.available && (
        <Card>
          <CardHeader title="Raise an issue" />
          <form action={raiseIssue} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
            <input type="hidden" name="projectId" value={id} />
            <input
              name="issueTitle"
              required
              placeholder="What is wrong, e.g. Wrong tile delivered"
              className={`${FIELD} sm:col-span-2`}
            />
            <input name="projectArea" placeholder="Area, e.g. Main bathroom" className={FIELD} />
            <select name="category" defaultValue="Other" className={FIELD}>
              {ISSUE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select name="priority" defaultValue="Normal" className={FIELD}>
              <option value="Normal">Normal</option>
              <option value="Urgent">Urgent</option>
            </select>
            <label className="text-xs text-navy-500 sm:col-span-3">
              Target resolution
              <input type="date" name="targetResolutionDate" className={`${FIELD} mt-1 w-full`} />
            </label>

            <textarea
              name="description"
              rows={2}
              placeholder="What happened"
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
                Saved as internal. Release it to the client with the switch on the issue.
              </p>
              <SubmitButton className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700">
                Log issue
              </SubmitButton>
            </div>
          </form>
        </Card>
      )}

      {issues.length === 0 ? (
        <ControlEmpty title="No issues" body="Nothing has been logged on this project." />
      ) : (
        <div className="space-y-3">
          {issues.map((i) => (
            <Card key={i.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">
                  {i.issueNumber} · {i.issueTitle}
                </span>
                <Badge tone={TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                {i.priority === 'Urgent' && <Badge tone="bad">Urgent</Badge>}
                {/* Both halves of the answer: the row's own flag AND the
                    project switch. An issue released on a closed portal
                    reaches nobody. */}
                <VisibilityTag shown={project.clientPortalEnabled && i.clientVisible} />
                <span className="ml-auto text-xs text-navy-400">
                  raised by {i.reportedBy || 'unknown'} on {shortDate(i.submittedDate)}
                </span>
              </div>

              <div className="mt-0.5 text-xs text-navy-400">
                {i.category}
                {i.projectArea !== '' && ` · ${i.projectArea}`}
                {i.assignedTo !== null && i.assignedTo !== ''
                  ? ` · assigned to ${i.assignedTo}`
                  : ' · unassigned'}
              </div>

              {i.description !== '' && (
                <p className="mt-3 text-sm leading-relaxed text-navy-600">{i.description}</p>
              )}

              <form action={updateIssueStatus} className="mt-3 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="issueId" value={i.id} />
                <input type="hidden" name="projectId" value={id} />
                <select name="status" defaultValue={i.status} className={FIELD}>
                  {ISSUE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  name="assignedTo"
                  defaultValue={i.assignedTo ?? ''}
                  placeholder="Assigned to"
                  className={FIELD}
                />
                <select name="priority" defaultValue={i.priority} className={FIELD}>
                  <option value="Normal">Normal</option>
                  <option value="Urgent">Urgent</option>
                </select>
                <input
                  type="date"
                  name="targetResolutionDate"
                  defaultValue={i.targetResolutionDate ?? ''}
                  className={FIELD}
                />

                <textarea
                  name="internalNotes"
                  defaultValue={i.internalNotes}
                  rows={2}
                  placeholder="Internal notes. Never sent to the client."
                  className={`${FIELD} sm:col-span-2`}
                />
                <textarea
                  name="resolution"
                  defaultValue={i.resolution}
                  rows={2}
                  placeholder="How it was resolved"
                  className={`${FIELD} sm:col-span-2`}
                />

                <input type="hidden" name="clientUpdate" value={i.clientUpdate} />

                <div className="sm:col-span-4">
                  <SubmitButton className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
                    Save
                  </SubmitButton>
                </div>
              </form>

              {/* Releasing asks for the client line at the same time. The two
                  are one decision: what to tell them, and whether to. */}
              <form
                action={releaseIssue}
                className="mt-3 space-y-2 border-t border-navy-100 pt-3"
              >
                <input type="hidden" name="issueId" value={i.id} />
                <input type="hidden" name="projectId" value={id} />
                <textarea
                  name="clientUpdate"
                  defaultValue={i.clientUpdate}
                  rows={2}
                  placeholder="What you want the homeowner to read"
                  className={`${FIELD} w-full`}
                />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={i.clientVisible}
                      className="rounded border-navy-300"
                    />
                    Show this issue to the client
                  </label>
                  <SubmitButton className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
                    Save client update
                  </SubmitButton>
                </div>
              </form>

              {/* Archive, never delete. An issue that was raised is a record,
                  and `HubClient` has no delete method at all. */}
              <form action={archiveIssue} className="mt-2 border-t border-navy-100 pt-2">
                <input type="hidden" name="issueId" value={i.id} />
                <input type="hidden" name="projectId" value={id} />
                <SubmitButton className="text-xs font-medium text-red-700 transition hover:underline">
                  Remove from the list
                </SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
