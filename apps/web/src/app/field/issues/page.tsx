import { ISSUE_CATEGORIES } from '@buildsuite/contracts';
import { ContractorProjectRef } from '@/components/project-code';
import { projectById } from '@/lib/project-codes';

import { SubmitButton } from '@/components/submit-button';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { getHubOperational, isPunchItem, type HubIssue } from '@/lib/hub-db/operational';
import { raiseIssue, updateIssueStatus } from '@/lib/actions/issues';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';

/**
 * Issues, from the site (D4 §5).
 *
 * ---------------------------------------------------------------------------
 * WHAT A CREW MEMBER MAY DO HERE
 *
 * Raise an issue, and move one to In Progress or Resolved. That is the whole
 * surface, and it matches §12.2: the crew reports what they find and works it;
 * the office decides what the homeowner is told.
 *
 * There is no release control on this page and no client-facing text box. Not
 * hidden — absent. `raiseIssue` does not read a client-visible flag from the
 * form at all, and `updateIssueStatus` ignores every field but the status when
 * the caller is field, so a crafted POST has nothing to set either.
 *
 * Internal notes ARE shown. They are internal to the COMPANY, and a crew member
 * is inside it; the client projection in `portal-gates.ts` is what keeps them
 * off a homeowner's screen.
 *
 * Punch list items live in the same table under their own category and have
 * their own screen, so they are excluded here.
 * ---------------------------------------------------------------------------
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = {
  Resolved: 'good',
  Closed: 'good',
  'In Progress': 'warn',
  Assigned: 'warn',
  Open: 'bad',
};

const FIELD = 'w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm';

export default async function FieldIssues() {
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
  const all: HubIssue[] = hub.available ? await hub.ops.listIssues(scope) : [];
  const issues = all
    .filter((i) => ids.has(i.projectId) && !isPunchItem(i))
    .sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));

  const open = issues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed');
  const done = issues.filter((i) => i.status === 'Resolved' || i.status === 'Closed');

  // The project itself, so the row can print its name AND its code. The old
  // `nameOf` fell back to the raw UUID when a project was not in the list;
  // <ContractorProjectRef> falls back to words instead.
  const projectOf = (projectId: string) => projectById(mine, projectId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Issues</h1>
        <p className="mt-1 text-sm text-navy-400">
          {open.length === 0
            ? 'Nothing outstanding on your projects'
            : `${open.length} still open on your projects`}
        </p>
      </div>

      {!hub.available ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            Issues are not available right now. Ask your PM to check the connection.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Raise an issue" />
            <form action={raiseIssue} className="space-y-3 px-4 py-4">
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
                <label htmlFor="issueTitle" className="text-xs font-medium text-navy-600">
                  What is wrong
                </label>
                <input id="issueTitle" name="issueTitle" required className={`${FIELD} mt-1.5`} />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="projectArea" className="text-xs font-medium text-navy-600">
                    Area
                  </label>
                  <input
                    id="projectArea"
                    name="projectArea"
                    placeholder="e.g. Main bathroom"
                    className={`${FIELD} mt-1.5`}
                  />
                </div>
                <div>
                  <label htmlFor="priority" className="text-xs font-medium text-navy-600">
                    Priority
                  </label>
                  <select
                    id="priority"
                    name="priority"
                    defaultValue="Normal"
                    className={`${FIELD} mt-1.5 bg-white`}
                  >
                    <option value="Normal">Normal</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="category" className="text-xs font-medium text-navy-600">
                  Category
                </label>
                <select
                  id="category"
                  name="category"
                  defaultValue="Other"
                  className={`${FIELD} mt-1.5 bg-white`}
                >
                  {ISSUE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="description" className="text-xs font-medium text-navy-600">
                  What happened
                </label>
                <textarea id="description" name="description" rows={3} className={`${FIELD} mt-1.5`} />
              </div>

              <p className="text-xs text-navy-400">
                Goes to your PM. Nothing here reaches the client directly.
              </p>
              <SubmitButton className="min-h-11 w-full rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-800">
                Raise issue
              </SubmitButton>
            </form>
          </Card>

          {issues.length === 0 ? (
            <Card className="px-4 py-8 text-center">
              <p className="text-sm text-navy-400">
                Nothing has been raised on your projects yet.
              </p>
            </Card>
          ) : (
            <ul className="space-y-3">
              {[...open, ...done].map((i) => (
                <li key={i.id}>
                  <Card className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-sm font-semibold text-navy-900">
                          {i.issueNumber} · {i.issueTitle}
                        </span>
                        <div className="mt-0.5 text-xs text-navy-400">
                          <ContractorProjectRef project={projectOf(i.projectId)} />
                          {i.projectArea !== '' && ` · ${i.projectArea}`} · raised{' '}
                          {shortDate(i.submittedDate)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                        {i.priority === 'Urgent' && <Badge tone="bad">Urgent</Badge>}
                      </div>
                    </div>

                    {i.description !== '' && (
                      <p className="mt-3 text-sm leading-relaxed text-navy-700">{i.description}</p>
                    )}

                    {i.internalNotes !== '' && (
                      <div className="mt-3 rounded-md border-l-2 border-navy-900 bg-navy-50 px-3 py-2.5">
                        <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                          Notes from the office
                        </div>
                        <p className="mt-1 text-sm leading-relaxed text-navy-700">
                          {i.internalNotes}
                        </p>
                      </div>
                    )}

                    {/* Two states, two taps. A crew member says what they did;
                        closing the issue out is the office's call. */}
                    {i.status !== 'Closed' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(['In Progress', 'Resolved'] as const)
                          .filter((s) => s !== i.status)
                          .map((s) => (
                            <form key={s} action={updateIssueStatus}>
                              <input type="hidden" name="issueId" value={i.id} />
                              <input type="hidden" name="projectId" value={i.projectId} />
                              <input type="hidden" name="status" value={s} />
                              <SubmitButton className="min-h-10 rounded-lg border border-navy-200 px-3.5 text-sm font-medium text-navy-700 transition hover:bg-navy-50">
                                {s === 'In Progress' ? 'Working on it' : 'Mark resolved'}
                              </SubmitButton>
                            </form>
                          ))}
                      </div>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        You see issues on your own projects. What the homeowner is told is written by your PM, not
        here.
      </p>
    </div>
  );
}
