import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TASK_STATUSES } from '@buildsuite/contracts';

import { SubmitButton } from '@/components/submit-button';
import { NoticeForm } from '@/components/notice-form';
import { NotLinkedToContractor } from '@/components/not-linked';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote } from '@/components/control';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubOperational } from '@/lib/hub-db/operational';
import { getHubMedia } from '@/lib/hub-db/media';
import { getHubTeam, type Membership } from '@/lib/hub-db/team';
import { projectSectionPath } from '@/lib/project-nav';
import {
  assignableCrew,
  assigneeLabel,
  KEEP_ASSIGNEE,
  type CrewOption,
} from '@/lib/task-assignment';
import { archiveProjectTask, createProjectTask, updateProjectTask } from '@/lib/actions';

/**
 * Tasks — the contractor assigns work to the crew on this project
 * (John, 2026-09-17).
 *
 * Each task can be given to one field crew member on the project. It lands on
 * their Tasks screen marked new, with the note from here shown as "From your
 * PM", and stays marked new until they tap "Got it" — which this screen shows
 * as "Not opened yet" or "Seen". Reassigning makes it new again for the new
 * person. See `lib/task-assignment.ts` for the rules.
 */

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';
const NOTICE =
  'rounded-lg border border-navy-100 bg-navy-50 px-3 py-2 text-xs leading-relaxed text-navy-700 sm:col-span-4';

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Completed: 'good',
  'Ready for Review': 'good',
  Blocked: 'warn',
  'Waiting on Client': 'warn',
  'Waiting on Material': 'warn',
  'Waiting on Inspection': 'warn',
};

function AssignSelect({
  options,
  current,
  currentLabel,
  className,
}: {
  options: CrewOption[];
  /** Who the task is with now; null for a new or unassigned task. */
  current: string | null;
  currentLabel: string;
  className: string;
}) {
  const offered = current === null || options.some((o) => o.id === current);
  return (
    <select
      name="assignedTo"
      defaultValue={current === null ? '' : offered ? current : KEEP_ASSIGNEE}
      aria-label="Assign to"
      className={className}
    >
      <option value="">Unassigned</option>
      {options.length > 0 && (
        <optgroup label="Crew on this project">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
      {!offered && (
        // Removed from the project or revoked since it was assigned. Kept as it
        // is unless the contractor picks someone else.
        <option value={KEEP_ASSIGNEE}>{currentLabel} — keep</option>
      )}
    </select>
  );
}

export default async function ProjectTasksControl({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const project = await (await currentDataSource(scope)).getProject(scope, id);
  if (project === null) notFound();

  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Tasks" />;
  }

  const hub = getHubOperational();
  const team = getHubTeam();
  let onProject: Membership[] = [];
  let everyone: Membership[] = [];
  if (team.available) {
    [onProject, everyone] = await Promise.all([
      team.team.listForProject(scope, id).catch(() => []),
      team.team.listTeam(scope).catch(() => []),
    ]);
  }
  const options = assignableCrew(onProject);
  const tasks = hub.available ? await hub.ops.listTasks(scope, id) : [];

  // Each task's own photos — what the crew sent back from it. Empty until
  // migration 0015 links them.
  const media = getHubMedia();
  const photosByTask = new Map(
    media.available
      ? await Promise.all(
          tasks.map(
            async (task) =>
              [task.id, await media.media.listForTask(scope, 'photo', task.id).catch(() => [])] as const,
          ),
        )
      : [],
  );
  const peopleHref = projectSectionPath(id, 'people');

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Tasks"
        subtitle="Assign work to the crew on this project. Each person sees what is assigned to them on their Tasks screen."
      />

      {!hub.available ? (
        <ControlNote>
          The Hub database is not connected, so tasks cannot be read or saved. Missing:{' '}
          {hub.missing.join(', ')}.
        </ControlNote>
      ) : (
        options.length === 0 && (
          <ControlNote>
            Nobody from your crew is on this project yet, so there is no one to assign to. Add them
            under{' '}
            <Link href={peopleHref} className="font-medium text-navy-900 underline underline-offset-2">
              People
            </Link>
            , then assign tasks here. You can still add a task now and assign it later.
          </ControlNote>
        )
      )}

      {hub.available && (
        <Card>
          <CardHeader title="New task" />
          <NoticeForm
            action={createProjectTask}
            className="grid gap-3 px-5 py-4 sm:grid-cols-4"
            noticeClassName={NOTICE}
          >
            <input type="hidden" name="projectId" value={id} />
            <input
              name="taskName"
              required
              placeholder="What needs doing, e.g. Rough-in electrical, kitchen"
              className={`${FIELD} sm:col-span-2`}
            />
            <AssignSelect options={options} current={null} currentLabel="" className={FIELD} />
            <input type="date" name="scheduledDate" aria-label="Scheduled date" className={FIELD} />

            <input
              name="assignedTrade"
              placeholder="Trade (optional), e.g. Electrical"
              className={`${FIELD} sm:col-span-2`}
            />
            <textarea
              name="pmNote"
              rows={2}
              placeholder="Instructions for the crew — they see this as “From your PM”"
              className={`${FIELD} sm:col-span-4`}
            />

            <div className="flex items-center justify-between gap-3 sm:col-span-4">
              <p className="text-xs text-navy-400">
                Only the person it is assigned to sees it. Never shown to the homeowner.
              </p>
              <SubmitButton className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700">
                Add task
              </SubmitButton>
            </div>
          </NoticeForm>
        </Card>
      )}

      {tasks.length === 0 ? (
        <ControlEmpty title="No tasks yet" body="Add the first task for this project and assign it to your crew." />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const who = assigneeLabel(everyone, task.assignedTo);
            return (
              <Card key={task.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-navy-900">{task.taskName}</span>
                  <Badge tone={TONE[task.status] ?? 'neutral'}>{task.status}</Badge>
                  {task.assignedTo !== null &&
                    (task.seenAt === null ? (
                      <Badge tone="warn">Not opened yet</Badge>
                    ) : (
                      <span className="text-xs text-navy-400">Seen {shortDate(task.seenAt.slice(0, 10))}</span>
                    ))}
                  <span className="ml-auto text-xs text-navy-500">
                    {who}
                    {task.scheduledDate !== '' && ` · ${shortDate(task.scheduledDate.slice(0, 10))}`}
                  </span>
                </div>

                {(photosByTask.get(task.id) ?? []).length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {(photosByTask.get(task.id) ?? []).map((photo) => (
                      <li key={photo.id}>
                        <a
                          href={`/api/files?id=${encodeURIComponent(photo.id)}&kind=photo`}
                          target="_blank"
                          rel="noreferrer"
                          title={photo.label}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/files?id=${encodeURIComponent(photo.id)}&kind=photo`}
                            alt={photo.label === '' ? 'Task photo' : photo.label}
                            loading="lazy"
                            className="h-16 w-16 rounded-lg bg-navy-50 object-cover"
                          />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                <NoticeForm
                  action={updateProjectTask}
                  className="mt-3 grid gap-2 sm:grid-cols-4"
                  noticeClassName={NOTICE}
                >
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <input
                    name="taskName"
                    defaultValue={task.taskName}
                    required
                    aria-label="Task"
                    className={`${FIELD} sm:col-span-2`}
                  />
                  <AssignSelect
                    options={options}
                    current={task.assignedTo}
                    currentLabel={who}
                    className={FIELD}
                  />
                  <select name="status" defaultValue={task.status} aria-label="Status" className={FIELD}>
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    name="scheduledDate"
                    defaultValue={task.scheduledDate.slice(0, 10)}
                    aria-label="Scheduled date"
                    className={FIELD}
                  />
                  <input
                    name="assignedTrade"
                    defaultValue={task.assignedTrade}
                    placeholder="Trade (optional)"
                    className={FIELD}
                  />
                  <textarea
                    name="pmNote"
                    defaultValue={task.pmNote}
                    rows={2}
                    placeholder="Instructions for the crew"
                    className={`${FIELD} sm:col-span-2`}
                  />

                  <div className="flex items-center gap-3 sm:col-span-4">
                    <SubmitButton className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
                      Save
                    </SubmitButton>
                    <span className="text-xs text-navy-400">
                      Choosing someone else makes it new on their Tasks screen.
                    </span>
                  </div>
                </NoticeForm>

                {/* Archive, never delete — like every other Hub record. */}
                <form action={archiveProjectTask} className="mt-2 border-t border-navy-100 pt-2">
                  <input type="hidden" name="projectId" value={id} />
                  <input type="hidden" name="taskId" value={task.id} />
                  <SubmitButton className="text-xs font-medium text-red-700 transition hover:underline">
                    Remove task
                  </SubmitButton>
                </form>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
