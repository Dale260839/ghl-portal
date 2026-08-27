import { submitFieldUpdate } from '@/lib/actions';

import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { stageLabel } from '@/lib/data/types';
import { currentDataSource } from '@/lib/data/current-source';

/**
 * Field Interface (§12.2). Mobile-first, large tap targets, minimal typing.
 *
 * The rule this screen exists to enforce: the update form ends in TWO separate
 * text areas — Internal Field Notes and Suggested Client Progress Summary — and
 * there is no publish button anywhere on it. Submitting sends the update to the
 * PM (WF3) and notifies nobody else.
 */
export default async function FieldToday({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const { submitted } = await searchParams;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);

  // §12.2 / §9.4 — a field user sees only assigned projects. Fixtures assign by
  // superintendent; with live data this filters on the project's Field Team.
  const assigned = projects.filter((p) => p.superintendent === 'Tony Alvarez');
  const assignedIds = new Set(assigned.map((p) => p.buildsuiteProjectId));
  const todaysTasks = tasks.filter((t) => assignedIds.has(t.projectId));

  return (
    <div className="space-y-5">
      {submitted === '1' && (
        <div className="rounded-lg border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Update submitted to your project manager for review.
        </div>
      )}

      <Card>
        <CardHeader title="Today's tasks" />
        <ul className="divide-y divide-navy-100">
          {todaysTasks.map((t) => {
            const project = projects.find((p) => p.buildsuiteProjectId === t.projectId);
            return (
              <li key={t.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-navy-900">{t.taskName}</div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {project?.projectName} · {t.assignedTrade}
                    </div>
                  </div>
                  <Badge
                    tone={
                      t.status === 'In Progress'
                        ? 'warn'
                        : t.status === 'Ready for Review'
                          ? 'good'
                          : 'neutral'
                    }
                  >
                    {t.status}
                  </Badge>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-lg bg-navy-900 px-3 py-2.5 text-sm font-semibold text-white"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-navy-200 px-3 py-2.5 text-sm font-medium text-navy-700"
                  >
                    Complete
                  </button>
                </div>
              </li>
            );
          })}
          {todaysTasks.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-navy-400">Nothing scheduled today.</li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHeader title="My projects" />
        <ul className="divide-y divide-navy-100">
          {assigned.map((p) => (
            <li key={p.buildsuiteProjectId} className="px-4 py-3">
              <div className="text-sm font-medium text-navy-900">{p.projectName}</div>
              <div className="mt-0.5 text-xs text-navy-400">
                {stageLabel(p)} · updated {shortDate(p.lastUpdatedDate)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
