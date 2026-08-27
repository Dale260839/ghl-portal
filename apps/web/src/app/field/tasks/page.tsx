import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Badge, Card, shortDate } from '@/components/ui';
import { isUnseen, projectsForField, tasksForField, unseenCount } from '@/lib/field-data';
import { markTaskSeen } from '@/lib/actions';

/**
 * Assigned tasks (D4 §5).
 *
 * *"Contractor can assign tasks in the notes; the field person gets a
 * notification/ding."* This is the screen the ding leads to.
 *
 * Two rules from §9.4 that this page enforces by what it asks for:
 *
 *   - Only tasks assigned to **this person**, on projects they are on. An
 *     unassigned project is not theirs to see at all.
 *   - No money anywhere. `tasksForField` never touches a financial field and
 *     the screen has nowhere to put one.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Completed: 'good',
  'Ready for Review': 'good',
  Blocked: 'warn',
  'Waiting on Client': 'warn',
  'Waiting on Material': 'warn',
  'Waiting on Inspection': 'warn',
};

export default async function FieldTasks() {
  const session = await getSession();
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = projectsForField(projects, session?.name ?? '');
  const assigned = tasksForField(tasks, mine, session?.name ?? '');
  const unseen = unseenCount(assigned);

  const nameOf = (projectId: string) =>
    mine.find((p) => p.buildsuiteProjectId === projectId)?.projectName ?? projectId;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Your tasks</h1>
        <p className="mt-1 text-sm text-navy-400">
          {unseen > 0
            ? `${unseen} new ${unseen === 1 ? 'assignment' : 'assignments'} from your PM`
            : 'Nothing new — you are up to date'}
        </p>
      </div>

      {assigned.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            Nothing assigned to you right now. Your PM will send tasks here.
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {assigned.map((task) => (
            <li key={task.id}>
              <Card
                className={`px-4 py-4 ${isUnseen(task) ? 'border-amber-accent/40 bg-amber-soft/40' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {isUnseen(task) && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-amber-accent"
                          aria-label="New"
                        />
                      )}
                      <span className="text-sm font-semibold text-navy-900">{task.taskName}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {nameOf(task.projectId)} · {task.assignedTrade}
                    </div>
                  </div>
                  <Badge tone={TONE[task.status] ?? 'neutral'}>{task.status}</Badge>
                </div>

                {task.pmNote !== '' && (
                  <div className="mt-3 rounded-md border-l-2 border-navy-900 bg-navy-50 px-3 py-2.5">
                    <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                      From your PM
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-navy-700">{task.pmNote}</p>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-navy-400">
                  <span>Scheduled {shortDate(task.scheduledDate)}</span>

                  {isUnseen(task) && (
                    // Marking it seen is what clears the ding. A field user with
                    // a badge they cannot clear stops trusting the badge.
                    <form action={markTaskSeen}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <button
                        type="submit"
                        className="min-h-9 rounded-lg bg-navy-900 px-3.5 text-sm font-semibold text-white transition hover:bg-navy-800"
                      >
                        Got it
                      </button>
                    </form>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        You see tasks assigned to you on your own projects. Costs, pricing and client payment
        details are not part of this view.
      </p>
    </div>
  );
}
