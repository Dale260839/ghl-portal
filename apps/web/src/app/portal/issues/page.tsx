import { currentPortalProject, issuesFor } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty, shortDate } from '@/components/ui';

/**
 * Issues & Requests — §6.7, the client half.
 *
 * The riskiest of the four Phase B screens, because an issue record carries
 * `Internal Notes` — squarely on the §9.3 deny-list, and exactly the field a
 * crew is most candid in. `issuesFor` returns a type that has no such property,
 * so this file could not render it if it tried.
 *
 * `assignedTo` is dropped too. Which of your people picked it up is not the
 * homeowner's business, and naming them invites the client to chase that person
 * instead of the PM.
 *
 * What the client sees is `Client Update` — the deliberate counterpart, written
 * by the PM. An issue with no client update does not appear at all: nobody has
 * decided to tell them about it yet.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Resolved: 'good',
  Closed: 'good',
  'In Progress': 'warn',
};

export default async function PortalIssues({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const issues = issuesFor(project);
  const open = issues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Issues &amp; Requests
          </h1>
          <p className="mt-1 text-sm text-navy-400">
            Anything you have raised, and where it stands.
          </p>
        </div>
        {project.allowIssueSubmission && (
          <button
            type="button"
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Raise an issue
          </button>
        )}
      </div>

      {issues.length === 0 ? (
        <PortalEmpty
          title="Nothing outstanding"
          body={
            project.allowIssueSubmission
              ? 'No issues have been raised on this project. Use the button above if something needs attention.'
              : 'No issues have been raised on this project.'
          }
        />
      ) : (
        <>
          {open.length > 0 && (
            <p className="text-sm text-navy-600">
              {open.length === 1 ? 'One item is' : `${open.length} items are`} still being worked on.
            </p>
          )}

          <div className="space-y-4">
            {issues.map((i) => (
              <Card key={i.id} className="px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-navy-900">
                      {i.issueNumber} · {i.issueTitle}
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {i.category}
                      {i.projectArea !== '' && ` · ${i.projectArea}`} · raised{' '}
                      {shortDate(i.submittedDate)}
                    </div>
                  </div>
                  <Badge tone={TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-navy-600">{i.description}</p>

                <div className="mt-4 rounded-md border-l-2 border-navy-900 bg-navy-50 px-3 py-2.5">
                  <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                    Update from your contractor
                  </div>
                  <p className="mt-1 text-sm text-navy-700">{i.clientUpdate}</p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-400">
                  {i.targetResolutionDate !== null && i.status !== 'Resolved' && (
                    <span>Target {shortDate(i.targetResolutionDate)}</span>
                  )}
                  {i.resolution !== '' && <span>Resolved — {i.resolution}</span>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        You see the update your project manager wrote for you. Internal notes between the crew and
        the office stay internal — they are not hidden on this page, they are never sent to it.
      </p>
    </div>
  );
}
