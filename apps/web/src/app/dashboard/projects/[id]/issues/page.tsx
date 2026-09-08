import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { ISSUES } from '@/lib/data/fixtures';
import { Badge, Card, InternalNote, shortDate } from '@/components/ui';
import { ControlButton, ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

const TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = {
  Resolved: 'good',
  Closed: 'good',
  'In Progress': 'warn',
  Assigned: 'warn',
  Open: 'bad',
};

/**
 * Issues — contractor control side. Every issue on the project, with the
 * internal notes and assignee the client never sees. The client sees an issue
 * only once you write a client-facing update on it — that published line is the
 * gate, so an issue nobody has spoken to the client about stays internal.
 */
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

  const issues = ISSUES.filter((i) => i.projectId === id).sort((a, b) =>
    b.submittedDate.localeCompare(a.submittedDate),
  );

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Issues"
        subtitle="Track every issue. Write a client update to surface one to the homeowner."
        clientHref={`/portal/issues?preview=${id}`}
        action={<ControlButton>Log issue</ControlButton>}
      />

      <ControlNote>
        The client sees an issue only when you publish a client update on it. The internal note and
        the assignee are yours alone.
      </ControlNote>

      {issues.length === 0 ? (
        <ControlEmpty title="No issues" body="Nothing has been logged on this project." />
      ) : (
        <div className="space-y-3">
          {issues.map((i) => {
            const clientCanSee = project.clientPortalEnabled && i.clientUpdate.trim() !== '';
            return (
              <Card key={i.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-900">
                        {i.issueNumber} · {i.issueTitle}
                      </span>
                      <Badge tone={TONE[i.status] ?? 'neutral'}>{i.status}</Badge>
                      {i.priority === 'Urgent' && <Badge tone="bad">Urgent</Badge>}
                      <VisibilityTag shown={clientCanSee} />
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {i.category} · {i.projectArea} · reported by {i.reportedBy} on{' '}
                      {shortDate(i.submittedDate)}
                      {i.assignedTo !== null ? ` · assigned to ${i.assignedTo}` : ' · unassigned'}
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed text-navy-600">{i.description}</p>

                {i.clientUpdate.trim() !== '' && (
                  <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <span className="text-xs font-medium tracking-wide uppercase">
                      Client update
                    </span>
                    <br />
                    {i.clientUpdate}
                  </div>
                )}

                <div className="mt-2.5">
                  <InternalNote label="Internal notes" size="xs">
                    {i.internalNotes}
                  </InternalNote>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
