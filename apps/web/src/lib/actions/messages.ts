'use server';

import { revalidatePath } from 'next/cache';

import { getSession } from '../session.ts';
import { assertCan } from '../permissions.ts';
import { actionTenantScope } from '../scope.ts';
import { requireAccess } from '../access.ts';
import { clientProjectsFor } from '../client-scope.ts';
import { hubScopeOfProject } from '../tenant-scope.ts';
import { currentDataSource } from '../data/current-source.ts';
import { getHubMessages, type HubMessages } from '../hub-db/messages.ts';

/**
 * The message write paths.
 *
 * A new file rather than another block in `lib/actions.ts`, which is already
 * fourteen hundred lines and is where every unrelated action goes to be hard to
 * find. Nothing here is imported by that file; the screens import this one
 * directly.
 *
 * ---------------------------------------------------------------------------
 * THE TWO KINDS OF CALLER
 *
 * A contractor holds a tenant scope, so their actions resolve it the usual way
 * with `actionTenantScope`. A homeowner holds none — they are not a tenant —
 * so `postClientMessage` scopes the write to the PROJECT they were already
 * authorized to read, exactly as `recordClientDecision` does. A project id they
 * were not given resolves to nothing and the message is refused, so a homeowner
 * cannot post into another homeowner's thread by editing a hidden field.
 *
 * Every action checks permission BEFORE it reads or writes anything. A hidden
 * button is a UI fact; a server action is something anyone can post to.
 * ---------------------------------------------------------------------------
 */

function revalidateThreads(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/messages`);
  revalidatePath('/portal/messages');
  revalidatePath('/field/messages');
}

/** The Hub's message repository, or a clear failure. Shared by the writes below. */
function repository(): HubMessages {
  const hub = getHubMessages();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return hub.messages;
}

/**
 * The contractor writes into the project thread.
 *
 * Internal unless the compose form's "Release to client" box is ticked. An
 * unchecked box submits nothing at all, so this is a presence test rather than
 * a value read.
 */
export async function postProjectMessage(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'create', 'message');

  const projectId = String(formData.get('projectId') ?? '');
  const body = String(formData.get('body') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  if (body.trim() === '') return;

  const scope = await actionTenantScope(session);
  await repository().post(
    scope,
    { projectId, body, clientVisible: formData.get('release') !== null },
    { name: session.name, role: session.role },
  );

  revalidateThreads(projectId);
}

/**
 * Release a message to the homeowner, or take it back.
 *
 * `update` rather than `create`: changing who can see an existing record is an
 * edit of that record, and the matrix grants it to a contractor alone.
 */
export async function setMessageVisibility(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'update', 'message');

  const messageId = String(formData.get('messageId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (messageId === '') throw new Error('messageId is required');

  const scope = await actionTenantScope(session);
  await repository().release(scope, messageId, String(formData.get('release') ?? '') === 'on');

  revalidateThreads(projectId);
}

/** Remove a message from the thread. Archived, never deleted. */
export async function archiveMessage(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'archive', 'message');

  const messageId = String(formData.get('messageId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (messageId === '') throw new Error('messageId is required');

  const scope = await actionTenantScope(session);
  await repository().archive(scope, messageId);

  revalidateThreads(projectId);
}

/**
 * The homeowner replies.
 *
 * Always client-visible, and `HubMessages.post` forces that rather than
 * trusting this call site: a homeowner cannot be shown a thread that hides
 * their own words back from them.
 */
export async function postClientMessage(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // The matrix grants `create` on a message to every role. What differs is the
  // thread each can reach, which is the check below rather than this one.
  assertCan(session.role, 'create', 'message');

  const projectId = String(formData.get('projectId') ?? '');
  const body = String(formData.get('body') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  if (body.trim() === '') return;

  // The project is the authority. `clientProjectsFor` returns only the projects
  // this person may see, so an id they were not given resolves to nothing.
  const access = await requireAccess();
  const db = await currentDataSource();
  const mine = await clientProjectsFor(access, db);
  const project = mine.find((p) => p.buildsuiteProjectId === projectId);
  if (project === undefined) throw new Error('that project is not one of yours');

  // The Hub files messages under the contractor, so the write needs the
  // project's contractor resolved, not only its owner profile.
  const scope = await hubScopeOfProject(project);
  if (scope === null) {
    throw new Error('this project is not linked to a contractor, so nothing can be filed under it');
  }
  await repository().post(
    scope,
    { projectId, body, clientVisible: true },
    { name: session.name, role: 'client' },
  );

  revalidateThreads(projectId);
}
