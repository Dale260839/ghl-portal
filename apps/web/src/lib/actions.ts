'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountForEmail, clearSession, getSession, homeFor, setSession } from './session';
import { planReturn, planViewAs, realIdentity, viewAsEnabled } from './view-as';
import { assertCan, ownsTask } from './permissions';
import { requireTenantScope } from './scope';
import { getHubRecords, ARCHIVABLE_TABLES, type ArchivableTable } from './hub-db/records';
import { getHubTeam, INVITABLE_ROLES, type InvitableRole } from './hub-db/team';
import { GRANTABLE_RESOURCES } from './permissions';
import type { Resource } from './permissions';

/** Which permission resource governs each archivable table. */
const RESOURCE_FOR_TABLE: Record<ArchivableTable, Resource> = {
  hub_milestones: 'milestone',
  hub_schedule_items: 'milestone',
  hub_tasks: 'task',
  hub_daily_updates: 'dailyUpdate',
  hub_issues: 'issue',
  hub_documents: 'document',
  hub_photos: 'photo',
};

import {
  approveInternally,
  createDraftUpdate,
  returnForRevision,
  saveClientSummary,
  setVisibility,
  VISIBILITY_SWITCHES,
} from './data/mutations';

import type { TenantScope } from './tenancy';
import { execute, describe } from './workflows/executor';
import { fixturePorts } from './workflows/fixture-ports';
import { planFieldUpdateSubmitted } from './workflows/wf3-update-submitted';
import { planFieldUpdateApproved } from './workflows/wf4-update-approved';
import { currentDataSource } from './data/current-source.ts';
import { TASKS } from './data/fixtures';
import { MESSAGES } from './data/portal-fixtures';

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get('email') ?? '');
  const account = accountForEmail(email);

  if (account === undefined) {
    return { error: 'Unknown account. Use one of the demo identities below.' };
  }

  // Demo build: no password check. Real auth is GHL portal login (§9.2).
  await setSession({
    role: account.role,
    name: account.name,
    email: account.email,
    contactId: account.contactId,
    authProfileIds: account.authProfileIds,
  });

  redirect(homeFor(account.role));
}

export async function signOut() {
  await clearSession();
  redirect('/');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Field Update Review actions (§12.1), mapped onto the §10 state machine.
 *
 * "Approve and Publish" runs **WF4** rather than reimplementing it. The other
 * three are state changes no §11 workflow covers.
 *
 * Contractor-only — a field user reaching this would be a §3.2 violation, so
 * the role is checked server-side rather than by hiding the buttons.
 */
export async function reviewUpdate(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // §12.1 / §10 — publishing is the contractor's decision and nobody else's.
  assertCan(session.role, 'publish', 'dailyUpdate');

  const id = String(formData.get('updateId') ?? '');
  const clientSummary = String(formData.get('clientSummary') ?? '');
  const action = String(formData.get('action') ?? '');

  if (action === 'publish') {
    const scope: TenantScope = {
      locationId: session.ghlLocationId ?? '',
      authProfileIds: session.authProfileIds ?? [],
    };
    const db = await currentDataSource(scope);
    const updates = await db.listDailyUpdates(scope);
    const row = updates.find((u) => u.id === id);
    if (row === undefined) throw new Error(`update ${id} not found`);
    const project = await db.getProject(scope, row.projectId);

    // The PM's edit is what gets published — not what the field wrote.
    saveClientSummary(id, clientSummary);

    const result = await execute(
      planFieldUpdateApproved({
        buildsuiteProjectId: row.projectId,
        updateId: id,
        managerApprovalStatus: 'Approved & Published',
        clientSummary,
        contactId: project?.primaryContactId ?? null,
        projectName: project?.projectName ?? row.projectId,
        today: today(),
        clientPortalEnabled: project?.clientPortalEnabled ?? false,
      }),
      fixturePorts,
    );
    // eslint-disable-next-line no-console
    console.log(describe(result));
  } else if (action === 'internal') {
    approveInternally(id, clientSummary);
  } else if (action === 'return') {
    returnForRevision(id);
  } else if (action === 'save') {
    saveClientSummary(id, clientSummary);
  }

  revalidatePath('/dashboard/updates');
  revalidatePath('/dashboard');
  revalidatePath('/portal');
}

/**
 * Client Visibility Settings (§12.1). Contractor-only — these switches are
 * clauses of the §9.1 gate, so who may change them is a security question, not
 * a UI one.
 */
export async function updateVisibility(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // §9.1 — the switches are clauses of the gate, so who may move them is a
  // security question rather than a UI one.
  assertCan(session.role, 'update', 'visibilitySettings');

  const projectId = String(formData.get('projectId') ?? '');

  // Unchecked boxes are absent from the payload, so read every switch explicitly
  // rather than iterating what was submitted.
  const switches = Object.fromEntries(
    VISIBILITY_SWITCHES.map((key) => [key, formData.get(key) === 'on']),
  ) as Record<(typeof VISIBILITY_SWITCHES)[number], boolean>;

  setVisibility(projectId, switches);

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}/visibility`);
  revalidatePath('/portal');
}

/** Field submits to the PM. Runs **WF3**, which never notifies the client. */
export async function submitFieldUpdate(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // §12.2 — the crew writes updates. Note this is `create`, not `publish`.
  assertCan(session.role, 'create', 'dailyUpdate');

  const projectId = String(formData.get('projectId') ?? '');
  const blocker = String(formData.get('blocker') ?? '');

  const updateId = createDraftUpdate(
    {
      projectId,
      submittedBy: session.name,
      workCompleted: String(formData.get('workCompleted') ?? ''),
      internalNotes: String(formData.get('internalNotes') ?? ''),
      clientSummary: String(formData.get('clientSummary') ?? ''),
      crewOnsite: Number(formData.get('crewOnsite') ?? 0),
      hoursWorked: Number(formData.get('hoursWorked') ?? 0),
      weather: String(formData.get('weather') ?? ''),
    },
    today(),
  );

  const fieldScope: TenantScope = {
    locationId: session.ghlLocationId ?? '',
    authProfileIds: session.authProfileIds ?? [],
  };
  const project = await (await currentDataSource(fieldScope)).getProject(fieldScope, projectId);

  const result = await execute(
    planFieldUpdateSubmitted({
      buildsuiteProjectId: projectId,
      updateId,
      submittedBy: session.name,
      projectName: project?.projectName ?? projectId,
      blocker,
      clientDecisionNeeded: formData.get('clientDecisionNeeded') === 'on',
    }),
    fixturePorts,
  );
  // eslint-disable-next-line no-console
  console.log(describe(result));

  revalidatePath('/field');
  revalidatePath('/dashboard/updates');
  revalidatePath('/dashboard');
  redirect('/field?submitted=1');
}

/**
 * "View as" — assume the field or client experience (D-016, demo scaffolding).
 *
 * The decision lives in `view-as.ts` so the tenancy rule is testable; this only
 * applies the result. Permission is re-checked here against the session rather
 * than trusted from the form, because the dropdown being hidden is a UI fact and
 * this is a server action anyone can post to.
 */
export async function viewAs(formData: FormData) {
  if (!viewAsEnabled()) throw new Error('View switching is disabled');

  const target = String(formData.get('role') ?? '');
  if (target !== 'contractor' && target !== 'field' && target !== 'client') {
    throw new Error(`unknown role "${target}"`);
  }

  const result = planViewAs(await getSession(), target);
  if (!result.ok) throw new Error(result.reason);

  await setSession(result.session);
  redirect(result.redirectTo);
}

/** Hands the assumed view back and restores the contractor identity. */
export async function returnToMyAccount() {
  const result = planReturn(await getSession());
  if (!result.ok) throw new Error(result.reason);

  await setSession(result.session);
  redirect(result.redirectTo);
}

/**
 * Mark an assigned task as seen — this is what clears the "ding" (D4 §5).
 *
 * Field-or-contractor only, checked server-side. It writes nothing but a
 * timestamp on a task the caller is already assigned to, so it does not widen
 * what the Hub owns.
 */
export async function markTaskSeen(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'update', 'task');

  const taskId = String(formData.get('taskId') ?? '');
  const task = TASKS.find((t) => t.id === taskId);

  // Permission and ownership are separate questions and both have to pass.
  // Without the second, a field user could clear somebody else's ding by
  // posting their task id.
  if (task !== undefined && ownsTask(session, task)) {
    task.seenAt = new Date().toISOString();
  }

  revalidatePath('/field');
  revalidatePath('/field/tasks');
}

/**
 * A message from the crew to their PM (D2 Step 3).
 *
 * Written `clientVisible: false` and `fromClient: false` — internal in both
 * directions. Nothing a crew member types here can reach the homeowner, which
 * is the whole reason the field interface has its own thread rather than
 * sharing the client's.
 */
export async function sendFieldMessage(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'create', 'message');

  const projectId = String(formData.get('projectId') ?? '');
  const body = String(formData.get('body') ?? '').trim();
  if (projectId === '' || body === '') return;

  MESSAGES.push({
    id: `msg-field-${MESSAGES.length + 1}`,
    projectId,
    threadId: `field-${projectId}`,
    threadCategory: 'Field',
    sender: session.name,
    senderRole: 'Field',
    fromClient: false,
    message: body,
    sentDate: new Date().toISOString().slice(0, 10),
    // Never client-visible. A crew note is not a client update; the only route
    // to a homeowner is a PM publishing one.
    clientVisible: false,
  });

  revalidatePath('/field/messages');
  redirect('/field/messages?sent=1');
}

// ── The Hub's own records: edit, archive, restore ───────────────────────────
//
// Everything below writes to the HUB's database, never BuildSuite's. A project
// belongs to BuildSuite, so editing or archiving one stores an overlay row that
// renders on top of it — see `lib/hub-db/records.ts`.

/** The scope and identity every Hub write needs, resolved once. */
async function hubWriteContext(action: 'update' | 'archive', resource: Resource) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  // Permission first, before anything is read or written. A hidden button is a
  // UI fact; a server action is something anyone can post to.
  assertCan(session.role, action, resource);

  const scope = await requireTenantScope();
  const hub = getHubRecords();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }

  return {
    scope,
    records: hub.records,
    actor: { name: session.name, role: session.role },
    // Tenancy for Hub rows is the contractor, per the 2026-08-31 finding.
    contractorId: scope.authProfileIds[0]!,
  };
}

export async function editProjectDetails(formData: FormData) {
  const { scope, records, actor, contractorId } = await hubWriteContext('update', 'project');

  const projectId = String(formData.get('projectId') ?? '');
  if (projectId === '') throw new Error('projectId is required');

  // Only fields the form actually submitted are patched. An absent field means
  // "leave it alone", which is different from an empty one meaning "clear it".
  const patch: Record<string, string | null> = {};
  for (const [field, key] of [
    ['title', 'titleOverride'],
    ['address', 'addressOverride'],
    ['clientName', 'clientNameOverride'],
    ['notes', 'notes'],
  ] as const) {
    if (formData.has(field)) patch[key] = String(formData.get(field) ?? '');
  }

  await records.editProject(scope, projectId, contractorId, patch, actor);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/projects');
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function archiveProject(formData: FormData) {
  const { scope, records, actor, contractorId } = await hubWriteContext('archive', 'project');

  const projectId = String(formData.get('projectId') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  const reason = String(formData.get('reason') ?? '').trim();

  await records.archiveProject(scope, projectId, contractorId, actor, reason);
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/projects');
  revalidatePath('/dashboard/archive');
}

export async function archiveRecord(formData: FormData) {
  const table = String(formData.get('table') ?? '') as ArchivableTable;
  if (!(ARCHIVABLE_TABLES as readonly string[]).includes(table)) {
    // An unknown table name from a form post is either a bug or someone
    // probing. Either way it does not reach the database.
    throw new Error(`${table} is not an archivable table`);
  }

  const { scope, records, actor } = await hubWriteContext('archive', RESOURCE_FOR_TABLE[table]);
  const id = String(formData.get('id') ?? '');
  if (id === '') throw new Error('id is required');

  await records.archiveRecord(scope, table, id, actor, String(formData.get('reason') ?? ''));
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/archive');
}

/**
 * Restore, from the Archive screen.
 *
 * Permission-checked as `archive` rather than as its own action: someone who
 * may take a record out of the working list may put it back. Splitting them
 * would create a state where a contractor can archive something and then cannot
 * undo it, which is worse than either.
 */
export async function restoreArchivedItem(formData: FormData) {
  const table = String(formData.get('table') ?? '');
  const id = String(formData.get('id') ?? '');
  if (id === '') throw new Error('id is required');

  if (table === 'project') {
    const { scope, records, actor, contractorId } = await hubWriteContext('archive', 'project');
    await records.restoreProject(scope, id, contractorId, actor);
  } else {
    if (!(ARCHIVABLE_TABLES as readonly string[]).includes(table)) {
      throw new Error(`${table} is not an archivable table`);
    }
    const { scope, records, actor } = await hubWriteContext(
      'archive',
      RESOURCE_FOR_TABLE[table as ArchivableTable],
    );
    await records.restoreRecord(scope, table as ArchivableTable, id, actor);
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/projects');
  revalidatePath('/dashboard/archive');
}

// ── Team: invitations, revocation, permission ticks ─────────────────────────

/** Contractor-only, checked here rather than trusted from a hidden button. */
async function teamContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  // Managing who has access is the contractor's alone. Not in the resource
  // matrix because a membership is not project data — it is the account.
  const real = realIdentity(session);
  if (real.role !== 'contractor') {
    throw new Error('only a contractor can manage the team');
  }

  const scope = await requireTenantScope();
  const hub = getHubTeam();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { scope, team: hub.team, actor: { name: session.name } };
}

export async function inviteTeamMember(formData: FormData) {
  const { scope, team, actor } = await teamContext();

  const role = String(formData.get('role') ?? '');
  if (!(INVITABLE_ROLES as readonly string[]).includes(role)) {
    throw new Error(`${role} is not a role a contractor can invite`);
  }

  const result = await team.invite(
    scope,
    {
      email: String(formData.get('email') ?? ''),
      fullName: String(formData.get('fullName') ?? ''),
      role: role as InvitableRole,
      projectIds: [],
    },
    actor,
  );

  revalidatePath('/dashboard/team');
  // The link is passed back through the URL because no mail sender is
  // configured yet — the contractor sends it themselves. It is single-use and
  // expires, and it goes to the person who was allowed to create it.
  redirect(
    `/dashboard/team?invited=${encodeURIComponent(result.membership.email)}&link=${encodeURIComponent(result.acceptUrl)}`,
  );
}

export async function revokeTeamMember(formData: FormData) {
  const { scope, team, actor } = await teamContext();
  await team.revoke(scope, String(formData.get('membershipId') ?? ''), actor);
  revalidatePath('/dashboard/team');
}

export async function restoreTeamMember(formData: FormData) {
  const { scope, team } = await teamContext();
  await team.restore(scope, String(formData.get('membershipId') ?? ''));
  revalidatePath('/dashboard/team');
}

export async function saveTeamGrants(formData: FormData) {
  const { scope, team, actor } = await teamContext();
  const membershipId = String(formData.get('membershipId') ?? '');
  if (membershipId === '') throw new Error('membershipId is required');

  // An unchecked box submits nothing, so every grantable resource is written
  // explicitly. Reading only the present keys would make unticking a no-op —
  // the contractor would click Save and nothing would change.
  const grants: Record<string, boolean> = {};
  for (const resource of GRANTABLE_RESOURCES) {
    grants[resource] = formData.get(resource) !== null;
  }

  await team.setGrants(scope, membershipId, grants, actor);
  revalidatePath('/dashboard/team');
}

/**
 * Redeem an invitation.
 *
 * No session is required and none may be assumed — the whole point is that the
 * person has no account yet. Authority comes from the token alone, which is why
 * it is checked against the database rather than trusted for being signed.
 */
export async function acceptInvitation(formData: FormData) {
  const token = String(formData.get('token') ?? '');
  const password = String(formData.get('password') ?? '');

  const hub = getHubTeam();
  if (!hub.available) throw new Error('the Hub database is not connected');

  const result = await hub.team.acceptInvite(token, password);
  if (!result.ok) {
    // The reason goes back in the URL so the page can be specific to someone
    // who already holds a valid link, without ever revealing anything to
    // someone holding an invalid one.
    redirect(`/invite/${encodeURIComponent(token)}?error=${result.reason}`);
  }

  // Sign them straight in. Making someone set a password and then immediately
  // log in with it is a step that exists only to make the developer's life
  // simpler.
  await setSession({
    role: result.membership.role,
    name: result.membership.fullName === '' ? result.membership.email : result.membership.fullName,
    email: result.membership.email,
    membershipId: result.membership.id,
    ...(result.membership.role === 'client' ? { contactId: result.membership.id } : {}),
  } as Parameters<typeof setSession>[0]);

  redirect(homeFor(result.membership.role));
}
