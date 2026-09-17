import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TASK_STATUSES } from '@buildsuite/contracts';

import { SubmitButton } from '@/components/submit-button';
import { NoticeForm } from '@/components/notice-form';
import { PhotoUploader } from '@/components/photo-uploader';
import { MarkSeenOnOpen } from '@/components/mark-seen-on-open';
import { ContractorProjectRef } from '@/components/project-code';
import { Badge, Card, shortDate } from '@/components/ui';
import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { tasksForField } from '@/lib/field-data';
import { markTaskSeen } from '@/lib/actions';
import { postTaskUpdate, setFieldTaskStatus, uploadTaskPhoto } from '@/lib/actions/field-tasks';

/**
 * One assigned task, opened (John, 2026-09-17).
 *
 * The Tasks list showed an assignment but nothing could be done with it. Here a
 * crew member reads the PM's note, sets the status, and sends an update with
 * photos from the phone. Only a task assigned to them, on a project they are
 * on, opens — anything else is a 404, not someone else's work.
 */

const TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  Completed: 'good',
  'Ready for Review': 'good',
  Blocked: 'warn',
  'Waiting on Client': 'warn',
  'Waiting on Material': 'warn',
  'Waiting on Inspection': 'warn',
};

const INPUT = 'w-full rounded-lg border border-navy-200 bg-white px-3 py-2.5 text-sm';
const NOTICE = 'rounded-lg border border-navy-100 bg-navy-50 px-3 py-2 text-sm leading-relaxed text-navy-800';

export default async function FieldTask({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(await requireAccess(), projects, tasks);
  const task = tasksForField(tasks, mine, session?.membershipId ?? '').find((t) => t.id === id);
  if (task === undefined) notFound();
  const project = mine.find((p) => p.buildsuiteProjectId === task.projectId);

  return (
    <div className="space-y-4">
      {task.seenAt === null && <MarkSeenOnOpen taskId={task.id} action={markTaskSeen} />}

      <Link href="/field/tasks" className="text-sm font-medium text-navy-500 hover:text-navy-800">
        ← Your tasks
      </Link>

      <Card className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight text-navy-900">{task.taskName}</h1>
          <Badge tone={TONE[task.status] ?? 'neutral'}>{task.status}</Badge>
        </div>
        <div className="mt-1 text-xs text-navy-500">
          <ContractorProjectRef project={project} />
          {task.assignedTrade !== '' && ` · ${task.assignedTrade}`}
        </div>
        <div className="mt-1 text-xs text-navy-400">
          {task.scheduledDate === '' ? 'No date set' : `Scheduled ${shortDate(task.scheduledDate.slice(0, 10))}`}
        </div>

        {task.pmNote !== '' && (
          <div className="mt-3 rounded-md border-l-2 border-navy-900 bg-navy-50 px-3 py-2.5">
            <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">From your PM</div>
            <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-navy-700">{task.pmNote}</p>
          </div>
        )}
      </Card>

      <Card className="px-4 py-4">
        <h2 className="text-sm font-semibold text-navy-900">Status</h2>
        <NoticeForm action={setFieldTaskStatus} className="mt-2 space-y-2" noticeClassName={NOTICE}>
          <input type="hidden" name="taskId" value={task.id} />
          <div className="flex gap-2">
            <select name="status" defaultValue={task.status} aria-label="Status" className={INPUT}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <SubmitButton className="min-h-10 shrink-0 rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition hover:bg-navy-800">
              Save
            </SubmitButton>
          </div>
        </NoticeForm>
      </Card>

      <Card className="px-4 py-4">
        <h2 className="text-sm font-semibold text-navy-900">Send an update</h2>
        <p className="mt-0.5 text-xs text-navy-400">
          Goes to your PM for review. Nothing here reaches the homeowner directly.
        </p>
        <NoticeForm action={postTaskUpdate} className="mt-3 space-y-3" noticeClassName={NOTICE}>
          <input type="hidden" name="taskId" value={task.id} />
          <label className="block text-xs font-medium text-navy-600">
            What did you do?
            <textarea name="text" rows={3} className={`${INPUT} mt-1.5`} placeholder="e.g. Ran the kitchen circuits, boxes set, ready for inspection" />
          </label>

          <div>
            <div className="text-xs font-medium text-navy-600">Photos</div>
            <div className="mt-1.5">
              <PhotoUploader upload={uploadTaskPhoto} fields={{ taskId: task.id }} countFieldName="photoCount" />
            </div>
          </div>

          <label className="block text-xs font-medium text-navy-600">
            Status
            <select name="status" defaultValue="" className={`${INPUT} mt-1.5`}>
              <option value="">Leave as {task.status}</option>
              {TASK_STATUSES.filter((s) => s !== task.status).map((s) => (
                <option key={s} value={s}>
                  Set to {s}
                </option>
              ))}
            </select>
          </label>

          <SubmitButton className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-navy-800">
            Send update to PM
          </SubmitButton>
        </NoticeForm>
      </Card>
    </div>
  );
}
