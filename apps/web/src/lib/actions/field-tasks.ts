'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess } from '../access.ts';
import { assertCan, ownsTask } from '../permissions.ts';
import { actionTenantScope } from '../scope.ts';
import { currentDataSource } from '../data/current-source.ts';
import { currentWriter } from '../data/current-writer.ts';
import { fieldProjectsFor } from '../field-scope.ts';
import { tasksForField } from '../field-data.ts';
import { getHubMedia } from '../hub-db/media.ts';
import { getHubStorage } from '../hub-db/storage.ts';
import { isTaskStatus } from '../task-assignment.ts';
import { acceptablePhoto, taskPhotoCaption, taskUpdateText } from '../field-task.ts';
import { notifyPmOfFieldSubmission } from '../notify/pm.ts';
import { execute, describe } from '../workflows/executor.ts';
import { fixturePorts } from '../workflows/fixture-ports.ts';
import { planFieldUpdateSubmitted } from '../workflows/wf3-update-submitted.ts';

/**
 * What a crew member does with a task assigned to them (John, 2026-09-17):
 * change its status, send their PM an update, and add photos from the phone.
 *
 * ---------------------------------------------------------------------------
 * WHOSE TASK
 *
 * Every action starts from the task id and re-reads it through the caller's
 * own scope, then requires BOTH that it is assigned to this person (by
 * membership) and that it is on a project they are on — the same two filters
 * their Tasks screen uses. The project a photo or update is filed under comes
 * from that stored task, never from the form.
 * ---------------------------------------------------------------------------
 */

type Notice = { notice?: string } | undefined;

async function myTask(taskId: string) {
  const access = await requireAccess();
  const scope = await actionTenantScope(access.session);
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(access, projects, tasks);
  const task = tasksForField(tasks, mine, access.session.membershipId ?? '').find((t) => t.id === taskId);
  if (task === undefined || !ownsTask(access.session, task)) {
    throw new Error('that task is not assigned to you');
  }
  const project = mine.find((p) => p.buildsuiteProjectId === task.projectId);
  return { access, scope, task, projectName: project?.projectName ?? '' };
}

function revalidateTask(taskId: string, projectId: string): void {
  revalidatePath('/field');
  revalidatePath('/field/tasks');
  revalidatePath(`/field/tasks/${taskId}`);
  revalidatePath(`/dashboard/projects/${projectId}/tasks`);
  revalidatePath(`/dashboard/projects/${projectId}/photos`);
  revalidatePath('/dashboard/updates');
}

export async function setFieldTaskStatus(_previous: Notice, formData: FormData): Promise<Notice> {
  const taskId = String(formData.get('taskId') ?? '');
  const { access, scope, task } = await myTask(taskId);
  // The crew starts and finishes their own work — `update` on a task is theirs.
  assertCan(access.role, 'update', 'task');
  if (!access.can('update', 'task')) throw new Error('not permitted');
  if (access.projectIds !== null && !access.projectIds.includes(task.projectId)) {
    throw new Error('project not assigned');
  }

  const status = String(formData.get('status') ?? '');
  if (!isTaskStatus(status)) return { notice: 'Choose a status from the list.' };
  if (status === task.status) return { notice: `Already ${status}.` };

  const writer = currentWriter();
  await writer.setTaskStatus(scope, task.id, status);
  // Changing the status means they have opened it.
  if (task.seenAt === null) await writer.markTaskSeen(scope, task.id);

  revalidateTask(task.id, task.projectId);
  return { notice: `Status set to ${status}. Your PM sees it on the project’s Tasks page.` };
}

export async function postTaskUpdate(_previous: Notice, formData: FormData): Promise<Notice> {
  const taskId = String(formData.get('taskId') ?? '');
  const { access, scope, task, projectName } = await myTask(taskId);
  // A daily update, like the Update screen writes. `create`, never `publish`:
  // the PM reviews it before anything reaches the homeowner.
  assertCan(access.role, 'create', 'dailyUpdate');

  const text = String(formData.get('text') ?? '').trim();
  const photoCount = Math.max(0, Math.floor(Number(formData.get('photoCount') ?? 0)) || 0);
  const postedStatus = String(formData.get('status') ?? '');
  const newStatus = isTaskStatus(postedStatus) && postedStatus !== task.status ? postedStatus : null;
  if (text === '' && photoCount === 0 && newStatus === null) {
    return { notice: 'Write what you did, add a photo, or change the status first.' };
  }

  const writer = currentWriter();
  if (newStatus !== null) {
    assertCan(access.role, 'update', 'task');
    await writer.setTaskStatus(scope, task.id, newStatus);
  }
  if (task.seenAt === null) await writer.markTaskSeen(scope, task.id);

  const updateId = await writer.createUpdate(scope, {
    projectId: task.projectId,
    taskId: task.id,
    submittedBy: access.session.name,
    workCompleted: taskUpdateText({ taskName: task.taskName, text, photoCount, newStatus }),
    internalNotes: '',
    crewOnsite: 0,
    hoursWorked: 0,
    weather: '',
  });

  const result = await execute(
    planFieldUpdateSubmitted({
      buildsuiteProjectId: task.projectId,
      updateId,
      submittedBy: access.session.name,
      projectName: projectName || task.projectId,
      blocker: '',
      clientDecisionNeeded: false,
    }),
    fixturePorts,
  );
  console.log(describe(result));

  const notified = await notifyPmOfFieldSubmission(scope, {
    kind: 'task',
    projectId: task.projectId,
    projectName: projectName || task.projectId,
    projectReference: '',
    submittedBy: access.session.name,
    taskName: task.taskName,
    workCompleted: text,
    blocker: '',
    photoCount,
  });

  revalidateTask(task.id, task.projectId);
  const withPhotos = photoCount > 0 ? ` with ${photoCount} photo${photoCount === 1 ? '' : 's'}` : '';
  const withStatus = newStatus !== null ? `, and the status is now ${newStatus}` : '';
  return {
    notice: notified.sent
      ? `Sent to your PM${withPhotos}${withStatus}. They have been emailed.`
      : `Saved for your PM${withPhotos}${withStatus}. Nobody was emailed — tell them if it is urgent.`,
  };
}

type UploadResult = { ok: true } | { ok: false; error: string };

async function storePhoto(input: {
  file: FormDataEntryValue | null;
  projectId: string;
  caption: string;
  /** The task it was taken on, so the task can list its own photos. */
  taskId?: string | null;
  scope: Awaited<ReturnType<typeof actionTenantScope>>;
  uploadedBy: string;
}): Promise<UploadResult> {
  const { file } = input;
  if (!(file instanceof File)) return { ok: false, error: 'No photo was received.' };
  const check = acceptablePhoto({ type: file.type, size: file.size });
  if (!check.ok) return { ok: false, error: check.reason };

  const storage = getHubStorage();
  const media = getHubMedia();
  if (!storage.available || !media.available) {
    return { ok: false, error: 'Photo storage is not connected right now. Try again later.' };
  }

  try {
    // The file first: if it fails, no row points at nothing.
    const stored = await storage.storage.upload(input.scope, {
      projectId: input.projectId,
      kind: 'photos',
      filename: file.name || 'photo.jpg',
      contentType: file.type,
      body: await file.arrayBuffer(),
    });
    await media.media.attach(
      input.scope,
      'photo',
      {
        projectId: input.projectId,
        label: input.caption,
        storagePath: stored.path,
        clientVisible: false,
        taskId: input.taskId ?? null,
      },
      { name: input.uploadedBy },
    );
    return { ok: true };
  } catch (error) {
    console.error('[photos] a field photo did not save', error);
    return { ok: false, error: 'The photo did not save. Check your signal and try again.' };
  }
}

/** One photo for a task, filed under the task's project and captioned with the task. */
export async function uploadTaskPhoto(formData: FormData): Promise<UploadResult> {
  const taskId = String(formData.get('taskId') ?? '');
  let context: Awaited<ReturnType<typeof myTask>>;
  try {
    context = await myTask(taskId);
  } catch {
    return { ok: false, error: 'That task is not assigned to you.' };
  }
  assertCan(context.access.role, 'create', 'photo');

  const result = await storePhoto({
    file: formData.get('file'),
    projectId: context.task.projectId,
    caption: taskPhotoCaption(context.task.taskName),
    taskId: context.task.id,
    scope: context.scope,
    uploadedBy: context.access.session.name,
  });
  if (result.ok) revalidateTask(context.task.id, context.task.projectId);
  return result;
}

/**
 * One photo for a project the crew member is on — the Update and Photos screens.
 * The project comes from the form here, so it is checked against their projects.
 */
export async function uploadFieldPhoto(formData: FormData): Promise<UploadResult> {
  const access = await requireAccess();
  assertCan(access.role, 'create', 'photo');
  const scope = await actionTenantScope(access.session);

  const projectId = String(formData.get('projectId') ?? '');
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  if (!fieldProjectsFor(access, projects, tasks).some((p) => p.buildsuiteProjectId === projectId)) {
    return { ok: false, error: 'Choose one of your projects first.' };
  }

  const caption = String(formData.get('caption') ?? '').trim();
  const result = await storePhoto({
    file: formData.get('file'),
    projectId,
    caption,
    scope,
    uploadedBy: access.session.name,
  });
  if (result.ok) {
    revalidatePath('/field/photos');
    revalidatePath(`/dashboard/projects/${projectId}/photos`);
  }
  return result;
}
