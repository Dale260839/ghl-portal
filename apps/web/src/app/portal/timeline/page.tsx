import { currentPortalProject, clientStageFor } from '@/lib/portal-data';
import { getDataSource } from '@/lib/data/source';
import { scopeOfProject } from '@/lib/scope';
import { toClientMilestones } from '@/lib/client-view';
import { Badge, Card, PortalEmpty, shortDate } from '@/components/ui';

export default async function PortalTimeline({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;

  const all = await getDataSource().listMilestones(scopeOfProject(project), project.buildsuiteProjectId);
  const milestones = toClientMilestones(all, project);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Project Timeline</h1>
        <p className="mt-1 text-sm text-navy-400">
          Track the major phases and milestones of your project.
        </p>
      </div>

      {milestones.length === 0 ? (
        <PortalEmpty
          title="Schedule not shared yet"
          body="Your contractor hasn't published the project schedule for this job."
        />
      ) : (
        <Card>
          <ol className="divide-y divide-navy-100">
            {milestones.map((m) => {
              const done = m.status === 'Completed';
              const active = m.status === 'In Progress';
              return (
                <li key={m.id} className="flex items-start gap-4 px-5 py-5">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                      done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : active
                          ? 'border-navy-900 bg-navy-900 text-white'
                          : 'border-navy-200 bg-white'
                    }`}
                  >
                    {done && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    )}
                    {active && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-base font-medium text-navy-900">{m.milestoneName}</span>
                      <Badge tone={done ? 'good' : active ? 'warn' : 'neutral'}>{m.status}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-navy-400">
                      {done ? `Completed ${shortDate(m.plannedEnd)}` : `Est. ${shortDate(m.plannedEnd)}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {project.projectStage !== undefined && (
        <p className="text-xs text-navy-400">
          Currently in the{' '}
          <strong className="font-semibold text-navy-600">
            {clientStageFor(project.projectStage)}
          </strong>{' '}
          phase.
        </p>
      )}
    </div>
  );
}
