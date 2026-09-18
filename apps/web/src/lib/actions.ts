'use server';

import { revalidatePath } from 'next/cache';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBuildSuiteReader } from './buildsuite/projects.ts';
import type { ClientLoginReader } from './auth/client-lookup.ts';
import { clientIpFrom, createRateLimiter, PASSWORD_SIGN_IN_LIMIT } from './auth/rate-limit.ts';
import { unifiedSignIn } from './auth/unified-sign-in.ts';
import {
  clientCodeLimiter,
  signInWithProjectCode,
  type SignedProjectReader,
} from './auth/client-credentials.ts';
import { resolveSessionSecret } from './auth/session-crypto.ts';
import {
  requestSignInLink,
  signInLimiter,
  signInRequestMessage,
} from './auth/sign-in-request.ts';
import { resolveEmailSender } from './email/sender.ts';
import { accountForEmail, clearSession, getSession, homeFor, setSession, type Session } from './session';
import { demoSignInEnabled } from './demo-accounts';

/** One limiter for the password path, for the life of the process. */
const passwordSignInLimiter = createRateLimiter(PASSWORD_SIGN_IN_LIMIT);
import { planReturn, planViewAs, realIdentity, viewAsEnabled } from './view-as';
import { assertCan, ownsTask } from './permissions';
import { actionTenantScope, requireTenantScope } from './scope';
import { getHubVisibility } from './hub-db/visibility';
import { isUuid } from './data/visibility-overlay.ts';
import { getHubRecords, ARCHIVABLE_TABLES, type ArchivableTable } from './hub-db/records';
import { getHubSchedule } from './hub-db/schedule.ts';
import { getHubMessages } from './hub-db/messages.ts';
import { getHubOperational } from './hub-db/operational.ts';
import { getHubMedia } from './hub-db/media.ts';
import { CLIENT_FOLDER, DEFAULT_FOLDER, isFieldFolder } from './document-folders.ts';
import { getHubSelections } from './hub-db/selections.ts';
import { requireAccess } from './access.ts';
import { clientProjectsFor } from './client-scope.ts';
import { hubScopeOfProject } from './tenant-scope.ts';
import { notifyHomeowner } from './notify/homeowner.ts';
import { MILESTONE_STATUSES, isMilestoneStatus, type Project } from './data/types.ts';
import { getHubStorage } from './hub-db/storage.ts';
import { getHubTeam } from './hub-db/team';
import { getHubInvoiceDrafts } from './hub-db/invoice-drafts';
import { getHubInvoiceTemplates } from './hub-db/invoice-templates.ts';
import {
  dueDaysFor,
  mergeLetterhead,
  validateTemplateInput,
  type InvoiceTemplate,
} from './invoicing/template.ts';
import { resolveInvoiceRail, draftFromStored } from './invoicing/rail.ts';
import { resolveContractorName, resolveContractorProfile } from './buildsuite/contractor-identity.ts';
import { getProposalsReader } from './buildsuite/proposals';
import { paymentScheduleDrafts } from './payment-schedule';
import { GRANTABLE_RESOURCES } from './permissions';
import { accountSwitchEnabled, findDevAccount } from './dev-accounts';
import { appUrl } from './app-url';
import { appointmentEmail, getGhlEmail, invitationEmail, passwordResetEmail } from './ghl/email';
import {
  appointmentRecipients,
  appointmentWhen,
  assigneeChoices,
  resolveAssignee,
  shouldNotify,
  type Assignee,
  type ResolvedAssignee,
} from './schedule-assignees.ts';
import { clientCode, contractorCode } from './project-codes.ts';
import {
  assignableCrew,
  assignmentChange,
  isTaskStatus,
  resolveTaskAssignee,
  type TaskAssignee,
} from './task-assignment.ts';
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

import { assertContractor, type TenantScope } from './tenancy';
import { execute, describe } from './workflows/executor';
import { fixturePorts } from './workflows/fixture-ports';
import { planFieldUpdateSubmitted } from './workflows/wf3-update-submitted';
import { planFieldUpdateApproved } from './workflows/wf4-update-approved';
import { currentDataSource } from './data/current-source.ts';
import { currentWriter } from './data/current-writer.ts';
import { TASKS } from './data/fixtures';
import { MESSAGES } from './data/portal-fixtures';

/**
 * The ONE sign-in (John, 2026-09-15). Email, and a password or project code.
 *
 * Who the person is — field crew, homeowner — is decided by `unifiedSignIn`
 * from what they typed, and tested there without a request. This is only the
 * wiring: the live checks, the caller's IP, and the cookie at the end.
 * Contractors do not come through here: they arrive by the BuildSuite /
 * GoHighLevel menu link (`/api/auth/ghl`), which is unchanged.
 *
 * Every session minted below carries `authProfileIds` — the profiles the
 * person reads under — because a session without them failed its first scoped
 * read on 2026-09-01, and a guardrail holds every call site to it.
 */
export async function signIn(
  _prev: { error?: string; email?: string } | undefined,
  formData: FormData,
) {
  const email = String(formData.get('email') ?? '');
  const secret = String(formData.get('secret') ?? '');
  const ip = clientIpFrom(await headers());

  const hub = getHubTeam();
  const buildsuite = getBuildSuiteReader();

  const outcome = await unifiedSignIn(email, secret, {
    member: hub.available ? hub.team : null,
    // The homeowner check needs BOTH databases: BuildSuite proves the signed
    // contract, the Hub opens the account. Either one missing is an outage, and
    // an outage must never become an unauthenticated sign-in — there is no
    // fixture path here at all.
    code: (who, code) =>
      buildsuite.available && hub.available
        ? signInWithProjectCode(who, code, {
            reader: buildsuite as SignedProjectReader,
            store: hub.team,
            limiter: clientCodeLimiter,
            ip,
          })
        : Promise.resolve({ result: 'unavailable' as const }),
    limiter: passwordSignInLimiter,
    ip,
    // Production passes null. See `demoSignInEnabled`.
    demo: demoSignInEnabled() ? accountForEmail : null,
  });

  // The email goes back so the form can keep it; the secret never does.
  if (outcome.result === 'refused') return { error: outcome.message, email: email.trim() };

  if (outcome.result === 'member') {
    const m = outcome.membership;
    await setSession({
      role: m.role,
      name: m.fullName === '' ? m.email : m.fullName,
      email: m.email,
      membershipId: m.id,
      // The contractor's profiles for a field member; none for a client, whose
      // access is their projects plus the gate.
      authProfileIds: m.authProfileIds,
    } as Session);
    redirect(homeFor(m.role as Session['role']));
  }

  if (outcome.result === 'client') {
    const m = outcome.membership;
    await setSession({
      role: 'client',
      name: m.fullName === '' ? m.email : m.fullName,
      email: m.email,
      membershipId: m.id,
      // EMPTY, and this is the privacy model rather than an oversight: a
      // homeowner reads only the Hub's own tables. No `contactId` either — it
      // would return every project that contact holds, including ones whose
      // code this person has never proved.
      authProfileIds: [],
    } as Session);
    redirect(homeFor('client'));
  }

  // Development only — `demoSignInEnabled()` is false on any deployment that
  // did not set it.
  const account = outcome.account;
  await setSession({
    role: account.role,
    name: account.name,
    email: account.email,
    contactId: account.contactId,
    authProfileIds: account.authProfileIds,
  } as Session);
  redirect(homeFor(account.role as Session['role']));
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
/** The scope a review action runs under. Small helper so the branches agree. */
function reviewScope(session: Session): Promise<TenantScope> {
  return actionTenantScope(session);
}

export async function reviewUpdate(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // §12.1 / §10 — publishing is the contractor's decision and nobody else's.
  assertCan(session.role, 'publish', 'dailyUpdate');

  const id = String(formData.get('updateId') ?? '');
  const clientSummary = String(formData.get('clientSummary') ?? '');
  const action = String(formData.get('action') ?? '');

  if (action === 'publish') {
    const scope = await actionTenantScope(session);
    const db = await currentDataSource(scope);
    const updates = await db.listDailyUpdates(scope);
    const row = updates.find((u) => u.id === id);
    if (row === undefined) throw new Error(`update ${id} not found`);
    const project = await db.getProject(scope, row.projectId);

    // The PM's edit is what gets published — not what the field wrote.
    const writer = currentWriter();
    await writer.saveClientSummary(scope, id, clientSummary);
    await writer.setApproval(scope, id, 'Approved & Published', today());

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

    // Tell the homeowner. Only the client summary travels, never the field
    // write-up; the email module cannot see anything else.
    if (project !== null) {
      await notifyHomeowner(scope, project, {
        kind: 'update',
        clientSummary,
        publishDate: today(),
      });
    }
  } else if (action === 'internal') {
    // §10 — recorded, and deliberately NOT visible to the client. The writer
    // derives client_visible from the status, so the two cannot drift apart.
    const writer = currentWriter();
    await writer.saveClientSummary(await reviewScope(session), id, clientSummary);
    await writer.setApproval(await reviewScope(session), id, 'Approved Internally', today());
  } else if (action === 'return') {
    await currentWriter().returnForRevision(await reviewScope(session), id);
  } else if (action === 'save') {
    await currentWriter().saveClientSummary(await reviewScope(session), id, clientSummary);
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

  // A live project's switches persist in the Hub — they are clauses of the §9.1
  // gate and must outlive the request. A fixture id keeps the in-memory path,
  // and so does a deployment with no Hub connection, where nothing can be saved.
  const hub = getHubVisibility();
  if (hub.available && isUuid(projectId)) {
    const scope = await actionTenantScope(session);
    await hub.visibility.setVisibility(scope, projectId, switches, {
      name: session.name,
      role: session.role,
    });
  } else {
    setVisibility(projectId, switches);
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}/visibility`);
  revalidatePath('/portal');
  // Chris saved and could not tell whether it took (11 Sep). Land back on the
  // page with a flag the page turns into a plain confirmation.
  redirect(`/dashboard/projects/${projectId}/visibility?saved=1`);
}

/** Field submits to the PM. Runs **WF3**, which never notifies the client. */
export async function submitFieldUpdate(formData: FormData) {
  const access = await requireAccess();
  const session = access.session;
  if (!access.can('create', 'dailyUpdate')) throw new Error('not permitted');
  // §12.2 — the crew writes updates. Note this is `create`, not `publish`.
  assertCan(session.role, 'create', 'dailyUpdate');

  const projectId = String(formData.get('projectId') ?? '');
  const blocker = String(formData.get('blocker') ?? '');

  // Built by `actionTenantScope`, not by hand. Assembling it here read
  // `session.ghlLocationId`, which an invited crew member does not have — so
  // submitting an update threw `refusing an unscoped read of submit update`
  // for exactly the people the screen is for.
  const fieldScope = await actionTenantScope(session);
  if (access.projectIds !== null && !access.projectIds.includes(projectId)) {
    throw new Error('project not assigned');
  }
  const project = await (await currentDataSource(fieldScope)).getProject(fieldScope, projectId);
  if (project === null) throw new Error('project not found');

  // Goes to the Hub's database when there is one. It used to go to an in-memory
  // array that the read path never consulted, so submitting did nothing
  // visible and anything that worked vanished on restart.
  //
  // The suggestion is stored on a Pending, non-client-visible update.
  // Only the PM's existing publish action can release it.
  const updateId = await currentWriter().createUpdate(fieldScope, {
    projectId,
    submittedBy: session.name,
    workCompleted: String(formData.get('workCompleted') ?? ''),
    internalNotes: String(formData.get('internalNotes') ?? ''),
    suggestedClientSummary: String(formData.get('clientSummary') ?? ''),
    crewOnsite: Number(formData.get('crewOnsite') ?? 0),
    hoursWorked: Number(formData.get('hoursWorked') ?? 0),
    weather: String(formData.get('weather') ?? ''),
    blocker,
    clientDecisionNeeded: formData.get('clientDecisionNeeded') === 'on',
  });

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
  if (taskId === '') throw new Error('taskId is required');

  // Read through the caller's own scope, from the same source the Tasks screen
  // reads. This used to look the id up in the fixture array whatever the
  // source, so on live data "Got it" found nothing and the badge never cleared.
  const scope = await actionTenantScope(session);
  const task = (await (await currentDataSource(scope)).listTasks(scope)).find((t) => t.id === taskId);

  // Permission and ownership are separate questions and both have to pass.
  // Without the second, a field user could clear somebody else's ding by
  // posting their task id.
  if (task !== undefined && ownsTask(session, task)) {
    const writer = currentWriter();
    await writer.markTaskSeen(scope, taskId);
    if (!writer.persistent) {
      const fixture = TASKS.find((t) => t.id === taskId);
      if (fixture !== undefined) fixture.seenAt = new Date().toISOString();
    }
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

  // Written to the Hub where there is one, so the note survives the request and
  // the contractor sees it on their side. Internal, and stored with the field
  // role so the contractor screen can say where it came from and offer no
  // release control for it.
  const hub = getHubMessages();
  if (hub.available) {
    await hub.messages.post(
      await actionTenantScope(session),
      { projectId, body, clientVisible: false },
      { name: session.name, role: 'field' },
    );
    revalidatePath('/field/messages');
    revalidatePath(`/dashboard/projects/${projectId}/messages`);
    redirect('/field/messages?sent=1');
  }

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
    // The CONTRACTOR id, resolved by requireTenantScope. Not an auth profile
    // id: they are different values and using one for the other filed records
    // where their owner could not see them.
    contractorId: assertContractor(scope, resource),
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

// `inviteTeamMember` — the global invitation — was removed on 2026-09-15.
// Invitations are per project now (`inviteToProject`), so there is exactly one
// way to invite someone and it always names the job they are invited to.

export async function revokeTeamMember(formData: FormData) {
  const { scope, team, actor } = await teamContext();
  await team.revoke(scope, String(formData.get('membershipId') ?? ''), actor);
  revalidatePath('/dashboard/team');
  // Also offered on each project's People section.
  revalidatePath('/dashboard/projects/[id]/people', 'page');
}

export async function restoreTeamMember(formData: FormData) {
  const { scope, team } = await teamContext();
  await team.restore(scope, String(formData.get('membershipId') ?? ''));
  revalidatePath('/dashboard/team');
  revalidatePath('/dashboard/projects/[id]/people', 'page');
}

// ── People, per project (John, 2026-09-15) ───────────────────────────────────
//
// "Invitation is per project." Every action below names a project, and the
// project is read back through the contractor's OWN tenant scope before anyone
// is added to it — a project id posted by hand must not put a crew member on
// another contractor's job. Each calls `teamContext()` first, which refuses
// anyone who is not really a contractor.

/** The project a People action is about: one of this contractor's, or a refusal. */
async function projectForPeople(scope: TenantScope, formData: FormData) {
  const projectId = String(formData.get('projectId') ?? '');
  const project = await (await currentDataSource(scope)).getProject(scope, projectId);
  if (project === null) throw new Error('that project is not one of yours');
  return {
    project,
    back: `/dashboard/projects/${encodeURIComponent(project.buildsuiteProjectId)}/people`,
  };
}

export async function inviteToProject(formData: FormData) {
  const { scope, team, actor } = await teamContext();
  const { project, back } = await projectForPeople(scope, formData);

  const outcome = await team.inviteToProject(
    scope,
    {
      email: String(formData.get('email') ?? ''),
      fullName: String(formData.get('fullName') ?? ''),
      projectId: project.buildsuiteProjectId,
    },
    actor,
    await appUrl(),
  );

  if (outcome.kind === 'refused') {
    redirect(`${back}?notice=${encodeURIComponent(outcome.reason)}`);
  }
  if (outcome.kind === 'added') {
    revalidatePath(back);
    redirect(`${back}?added=${encodeURIComponent(outcome.membership.email)}`);
  }

  // A new person: the same delivery as a Team invitation — GoHighLevel when
  // sending is on, and the link handed back either way.
  let delivery = 'none';
  const mail = getGhlEmail(scope.locationId);
  if (mail.available) {
    const { subject, html } = invitationEmail({
      inviterName: actor.name,
      companyName: String(formData.get('companyName') ?? ''),
      role: 'field',
      acceptUrl: outcome.result.acceptUrl,
    });
    const sent = await mail.email.send({
      email: outcome.result.membership.email,
      name: outcome.result.membership.fullName,
      subject,
      html,
    });
    delivery = sent.sent ? 'sent' : sent.reason;
  }
  revalidatePath(back);
  revalidatePath('/dashboard/team');
  redirect(
    `${back}?kind=invite&who=${encodeURIComponent(outcome.result.membership.email)}&link=${encodeURIComponent(outcome.result.acceptUrl)}&delivery=${delivery}`,
  );
}

export async function addMemberToProject(formData: FormData) {
  const { scope, team } = await teamContext();
  const { project, back } = await projectForPeople(scope, formData);
  await team.addToProject(scope, String(formData.get('membershipId') ?? ''), project.buildsuiteProjectId);
  revalidatePath(back);
  revalidatePath('/dashboard/team');
}

export async function removeMemberFromProject(formData: FormData) {
  const { scope, team } = await teamContext();
  const { project, back } = await projectForPeople(scope, formData);
  await team.removeFromProject(scope, String(formData.get('membershipId') ?? ''), project.buildsuiteProjectId);
  revalidatePath(back);
  revalidatePath('/dashboard/team');
}

/**
 * Send a field worker a link to set a new password. See `issuePasswordReset`.
 *
 * The link comes back to the contractor as well as going by email, the same as
 * an invitation: if sending is off or fails, they can pass it on themselves.
 */
export async function resetMemberPassword(formData: FormData) {
  const { scope, team, actor } = await teamContext();
  const { back } = await projectForPeople(scope, formData);
  const reset = await team.issuePasswordReset(
    scope,
    String(formData.get('membershipId') ?? ''),
    actor,
    await appUrl(),
  );

  // Somebody who never accepted their invitation gets invitation wording — "set
  // a NEW password" to a person who never had one reads as a mistake.
  const isReset = reset.membership.activated;
  const companyName = String(formData.get('companyName') ?? '');
  let delivery = 'none';
  const mail = getGhlEmail(scope.locationId);
  if (mail.available) {
    const { subject, html } = isReset
      ? passwordResetEmail({ inviterName: actor.name, companyName, resetUrl: reset.resetUrl })
      : invitationEmail({ inviterName: actor.name, companyName, role: 'field', acceptUrl: reset.resetUrl });
    const sent = await mail.email.send({
      email: reset.membership.email,
      name: reset.membership.fullName,
      subject,
      html,
    });
    delivery = sent.sent ? 'sent' : sent.reason;
  }
  redirect(
    `${back}?kind=${isReset ? 'reset' : 'invite'}&who=${encodeURIComponent(reset.membership.email)}&link=${encodeURIComponent(reset.resetUrl)}&delivery=${delivery}`,
  );
}

/**
 * Reassign which projects a member may see.
 *
 * The same validation as the invite form, for the same reason: the ids come
 * from a form, and only the contractor's own projects may be handed out.
 */
/**
 * Save a contractor's review of one invoice line.
 *
 * Seeds the proposal's drafts first, so the row exists whether or not this
 * screen has been opened before — seeding upserts on the line and never
 * overwrites contractor-supplied fields.
 *
 * The amount is parsed strictly: an empty box means "not supplied yet", which
 * is NOT zero. Zero is a figure a contractor could send to a homeowner by
 * accident, so it can only be reached by typing it.
 */
export async function saveInvoiceDraft(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  assertCan(session.role, 'update', 'invoice');

  const scope = await actionTenantScope(session);
  const hub = getHubInvoiceDrafts();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }

  const projectId = String(formData.get('projectId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  const lineOrder = Number(formData.get('lineOrder') ?? 0);
  if (projectId === '' || proposalId === '' || !Number.isInteger(lineOrder) || lineOrder < 1) {
    throw new Error('projectId, proposalId and lineOrder are required');
  }

  const rawAmount = String(formData.get('amount') ?? '').trim();
  let amount: number | null = null;
  if (rawAmount !== '') {
    const parsed = Number(rawAmount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`"${rawAmount}" is not an amount that can be invoiced`);
    }
    amount = parsed;
  }

  const text = (name: string): string | null => {
    const value = String(formData.get(name) ?? '').trim();
    return value === '' ? null : value;
  };

  // The proposal document, so the stored draft records what was actually
  // parsed rather than what this form happened to post back.
  const reader = getProposalsReader();
  const content = reader.available
    ? await reader.readContent(scope, projectId, proposalId)
    : null;

  const actor = { name: session.name };
  await hub.drafts.seedFromSchedule(
    scope,
    { projectId, proposalId, drafts: paymentScheduleDrafts(content, null) },
    actor,
  );

  const existing = await hub.drafts.listForProposal(scope, proposalId);
  const row = existing.find((d) => d.lineOrder === lineOrder);
  if (row === undefined) {
    throw new Error(`line ${lineOrder} is not in this proposal's payment schedule`);
  }

  await hub.drafts.save(
    scope,
    row.id,
    { title: text('title'), amount, description: text('description') },
    actor,
  );

  revalidatePath('/dashboard/invoices');
}

export async function saveTeamProjects(formData: FormData) {
  const { scope, team } = await teamContext();
  const membershipId = String(formData.get('membershipId') ?? '');
  if (membershipId === '') throw new Error('membershipId is required');

  const requested = new Set(formData.getAll('projectIds').map((v) => String(v)));
  const db = await currentDataSource(scope);
  const projectIds = (await db.listProjects(scope))
    .map((p) => p.buildsuiteProjectId)
    .filter((id) => requested.has(id));

  await team.setProjects(scope, membershipId, projectIds);
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
    // The SAME fields `signIn` sets. Leaving these out is what made accepting an
    // invitation land on a TenancyError: the session had no profiles, so the
    // first scoped read refused before any screen could render. Two paths that
    // mint a session have to mint the same one.
    authProfileIds: result.membership.authProfileIds,
    // NOT `contactId: membership.id`. It was, and a membership id is not a
    // GoHighLevel contact id — the lookup matched nothing, so every invited
    // homeowner reached an empty portal that said no projects were associated
    // with their account. An invited client's projects come from the ticked
    // list on their membership; see `lib/client-scope.ts`.
  } as Parameters<typeof setSession>[0]);

  redirect(homeFor(result.membership.role));
}

/**
 * Sign in as another contractor. **Development scaffolding.**
 *
 * Refuses unless `ENABLE_ACCOUNT_SWITCH=true`, checked HERE and not only in the
 * component that renders the menu. A hidden button is a UI fact; a server
 * action is something anyone can post to, and this one hands out somebody
 * else's data.
 *
 * The account is looked up by id rather than taken from the form, so a posted
 * profile id that is not on the list does nothing.
 */
export async function switchAccount(formData: FormData) {
  if (!accountSwitchEnabled()) {
    throw new Error('account switching is disabled');
  }

  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  if (realIdentity(session).role !== 'contractor') {
    throw new Error('only a contractor account can switch');
  }

  const account = await findDevAccount(String(formData.get('authProfileId') ?? ''));
  if (account === null) throw new Error('unknown account');

  await setSession({
    role: 'contractor',
    name: account.businessName === '' ? account.email : account.businessName,
    email: account.email,
    authProfileIds: [account.authProfileId],
    ghlLocationId: account.locationId,
  });

  // Everything reads through the scope, so every surface changes at once.
  revalidatePath('/', 'layout');
  // Land on the Portfolio Dashboard — the home of the contractor experience
  // since the 8 Sep redesign — rather than one section of it.
  redirect('/dashboard');
}

/**
 * Client sign-in request (§9.2, C-2) — the front door.
 *
 * Email plus project code LOCATE a record and mint nothing; the emailed
 * single-use token is the credential. So this action deliberately returns the
 * same message whether or not anything matched. See `sign-in-request.ts` for
 * the full reasoning; the guarantee lives there, and this is only the wiring.
 */
export async function requestSignIn(
  _prev: { message?: string } | undefined,
  formData: FormData,
): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '');
  const projectCode = String(formData.get('projectCode') ?? '');

  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? '';
  const forwardedProto = requestHeaders.get('x-forwarded-proto') ?? 'https';
  const origin =
    process.env.PUBLIC_ORIGIN?.trim() ||
    (forwardedHost === '' ? '' : `${forwardedProto}://${forwardedHost}`);

  // The live reader. Unavailable BuildSuite credentials must not become an
  // unauthenticated sign-in, so a missing reader locates nothing rather than
  // falling back to fixtures.
  const buildsuite = getBuildSuiteReader();
  const reader: ClientLoginReader = buildsuite.available
    ? buildsuite
    : { findProjectForClientLogin: async () => null };

  const outcome = await requestSignInLink(email, projectCode, {
    sender: resolveEmailSender(),
    secret: resolveSessionSecret(),
    origin,
    limiter: signInLimiter,
    reader,
    ip: clientIpFrom(requestHeaders),
  });

  return { message: signInRequestMessage(outcome) };

}

// `signInWithCode` — the homeowner's separate sign-in action — was folded into
// `signIn` on 2026-09-15. One form, one action; the homeowner check itself is
// unchanged (`auth/client-credentials.ts`).

/**
 * Create this invoice on the rail. **A write to a live system.**
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It creates a DRAFT in GoHighLevel and stops. Nobody is emailed, nothing is
 * charged, and the invoice sits in GHL until a person opens it and clicks send
 * — which is Chris's rule verbatim: the send is always a human step, so the
 * contractor can add a note first.
 *
 * So `sent_at` stays null and the status stops at `ready`. Recording this as
 * "sent" would tell a contractor a homeowner had been invoiced when they had
 * not.
 *
 * It refuses to create a second invoice for a line that already has one. Two
 * live invoices for one instalment is a homeowner asked to pay twice, and the
 * check is in the database as well as here (`external_id is null` in the
 * update's filter, plus a unique index) because a double-submit races.
 * ---------------------------------------------------------------------------
 */
/**
 * Save this account's invoice template (Chris, huddle 2026-09-10).
 *
 * The look of every invoice — logo, business name, contact details, standing
 * terms, days until due. Never its contents: stages and amounts come from each
 * job's signed contract. See `invoicing/template.ts` for how it merges over the
 * BuildSuite profile.
 *
 * Returns field errors rather than throwing, so the form can say which box is
 * wrong. The contractor id comes from the scope, never from the form.
 */
export async function saveInvoiceTemplate(
  _prev: { saved?: boolean; errors?: Record<string, string>; message?: string } | undefined,
  formData: FormData,
): Promise<{ saved?: boolean; errors?: Record<string, string>; message?: string }> {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // The look of an invoice is part of invoicing, which §12.1 gives to the
  // contractor alone.
  assertCan(session.role, 'update', 'invoice');

  const scope = await actionTenantScope(session);
  if (scope.contractorId === undefined) {
    return { message: 'This account is not linked to a contractor record, so it has no invoices to style.' };
  }
  const hub = getHubInvoiceTemplates();
  if (!hub.available) {
    return { message: `The Hub database is not connected (missing ${hub.missing.join(', ')}), so the template cannot be saved.` };
  }

  const checked = validateTemplateInput(Object.fromEntries(formData.entries()));
  if (!checked.ok) return { errors: checked.errors as Record<string, string> };

  await hub.templates.save(scope, checked.template, { name: session.name });
  revalidatePath('/dashboard/invoices');
  revalidatePath('/dashboard/invoices/template');
  return { saved: true };
}

export async function createInvoiceOnRail(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // Issuing an invoice is a contractor act. §12.1 — only they control money.
  assertCan(session.role, 'create', 'invoice');

  const scope = await actionTenantScope(session);
  const hub = getHubInvoiceDrafts();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }

  const draftId = String(formData.get('draftId') ?? '');
  const proposalId = String(formData.get('proposalId') ?? '');
  if (draftId === '' || proposalId === '') {
    throw new Error('draftId and proposalId are required');
  }

  // Read the draft back rather than trusting the form for anything that ends up
  // on a document a homeowner receives.
  const stored = await hub.drafts.listForProposal(scope, proposalId);
  const draft = stored.find((d) => d.id === draftId);
  if (draft === undefined) throw new Error('that invoice draft is not one of yours');

  if (draft.externalId !== null) {
    throw new Error(
      `this invoice already exists on ${draft.sentVia ?? 'the rail'} as ${draft.externalId}. ` +
        'Creating another would be a second invoice for the same instalment.',
    );
  }
  if (draft.amount === null) {
    throw new Error('this invoice has no amount yet. Enter one before creating it.');
  }

  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, draft.projectId);
  if (project === null) throw new Error('that project is not readable');

  // The contractor's own logo and contact details, so the invoice GHL receives
  // is theirs rather than a bare line item (Chris, 10 Sep). Null when the
  // session is not linked to a contractor record; the rail then sends no
  // business block at all rather than somebody else's name.
  const profile = await resolveContractorProfile(scope);
  // The account's invoice template, filled-in fields overriding BuildSuite's
  // (huddle 2026-09-10). Optional: a template that cannot be read leaves the
  // invoice exactly as it was before templates existed, never blocked.
  let template: InvoiceTemplate | null = null;
  const templates = getHubInvoiceTemplates();
  if (templates.available) {
    try {
      template = await templates.templates.getForContractor(scope);
    } catch (err) {
      console.warn('[invoice] template unavailable, using the BuildSuite profile:', (err as Error).message);
    }
  }
  const rail = resolveInvoiceRail(
    process.env,
    mergeLetterhead(profile, template),
    scope.locationId,
    { dueInDays: dueDaysFor(template), standingTerms: template?.standingTerms ?? null },
  );
  // The homeowner's email, read once for this purpose. Without it the rail
  // refuses (an invoice with nobody to send it to), which is what happened
  // on every attempt until 10 Sep: the recipient was built with email ''.
  const buildsuiteForEmail = getBuildSuiteReader();
  const clientEmail = buildsuiteForEmail.available
    ? await buildsuiteForEmail.clientEmailForProject(scope, draft.projectId)
    : null;

  // A database claim protects across tabs and server instances. Never expire it
  // automatically: an interrupted request may already have reached GHL.
  const attemptId = randomUUID();
  let claimed;
  try {
    claimed = await hub.drafts.claimRailCreation(scope, draftId, attemptId);
  } catch {
    redirect('/dashboard/invoices?rail=' + encodeURIComponent('Invoice creation could not be safely reserved. No GHL request was made. Check Hub migration 0014 and the existing attempt before retrying.'));
  }
  if (claimed === null) {
    redirect('/dashboard/invoices?uncertain=1&rail=' + encodeURIComponent('This invoice is already created, being created, or awaiting reconciliation. Check GoHighLevel before any retry.'));
  }
  let result;
  try {
    const invoice = draftFromStored(claimed, project);
    result = await rail.createDraft(invoice, {
      ghlContactId: project.primaryContactId,
      name: project.clientName,
      // The contact already holds the recipient address.
      email: clientEmail ?? '',
    });
  } catch {
    redirect('/dashboard/invoices?uncertain=1&rail=' + encodeURIComponent('Creation was interrupted. The invoice remains locked for review; check GoHighLevel before any retry.'));
  }

  if (!result.created) {
    // Land back on the Invoices screen with the reason in plain sight. A thrown
    // error reaches production as a digest and nothing else, which is what
    // Chris saw on 14 Sep: the rail refused and nobody could read why. An
    // uncertain failure is flagged as such, because the invoice MAY exist on
    // the rail and a second click would invoice the homeowner twice.
    const params = new URLSearchParams({
      rail: result.reason,
      draft: draftId,
      uncertain: '1',
    });
    redirect(`/dashboard/invoices?${params.toString()}`);
  }

  try {
    await hub.drafts.recordRailCreation(
      scope,
      draftId,
      { name: result.rail, externalId: result.externalId, externalUrl: result.editUrl },
      { name: session.name },
      attemptId,
    );
  } catch {
    redirect('/dashboard/invoices?uncertain=1&rail=' + encodeURIComponent('GoHighLevel created invoice ' + result.externalId + ', but its Hub reference could not be saved. The attempt stays locked. Reconcile this ID in GHL; do not create another invoice.'));
  }

  revalidatePath('/dashboard/invoices');
}

// ── Schedule (§6.3) ─────────────────────────────────────────────────────────
//
// The Schedule screen rendered a fixture list behind a button with no handler.
// These are the write paths behind it. Every one asserts the contractor, and
// `/dashboard` already refuses any session that is not one — the route is the
// first gate, `assertCan` the second, and the tenant filter on the row the
// third.

/** The Hub's schedule repository, or a clear failure. Shared by the three below. */
async function scheduleContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const hub = getHubSchedule();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { session, scope: await actionTenantScope(session), schedule: hub.schedule };
}

/**
 * A datetime-local input gives `2026-09-10T08:00` or nothing at all.
 *
 * Returned as null rather than an empty string, because an appointment with no
 * date is a real state — a job pencilled in before the date is agreed — and
 * `''` would be stored as a date nobody can order by.
 */
function optionalDateTime(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * The project, and who on it an appointment can be tagged with.
 *
 * Read through the contractor's own scope, so a posted project id that is not
 * theirs is refused before anything is saved or anyone is emailed. The crew
 * list is the same one People shows; if the Hub cannot list it, only the
 * homeowner is offered rather than the save failing.
 */
async function schedulePeople(scope: TenantScope, projectId: string) {
  const project = await (await currentDataSource(scope)).getProject(scope, projectId);
  if (project === null) throw new Error('that project is not one of yours');

  const team = getHubTeam();
  const crew = team.available ? await team.team.listForProject(scope, projectId).catch(() => []) : [];
  return { project, choices: assigneeChoices({ clientName: project.clientName, crew }), crew };
}

/**
 * Email an appointment to the contractor and to the person tagged on it.
 *
 * Every address comes from a server read — the contractor's BuildSuite record
 * (falling back to the signed-in contractor), the homeowner's contract, the
 * crew member's membership. None comes from the form.
 *
 * Sending is best-effort and never undoes the save: the appointment is already
 * stored, and the screen is told what happened so the contractor can pass the
 * date on themselves when email is off or fails. Returns that sentence.
 */
async function emailAppointment(input: {
  session: Session;
  scope: TenantScope;
  project: Project;
  assignee: Assignee;
  crew: { id: string; email: string }[];
  appointment: { title: string; startsAt: string | null; endsAt: string | null; status: string; notes: string };
}): Promise<string> {
  const { session, scope, project, assignee, appointment } = input;
  const who = assignee.kind === 'homeowner' ? 'the homeowner' : assignee.label;

  const mail = getGhlEmail(scope.locationId);
  if (!mail.available) {
    return `Saved. Not emailed: GoHighLevel is not configured here, so tell ${who} and yourself directly.`;
  }

  const assigneeEmail =
    assignee.kind === 'homeowner'
      ? await (async () => {
          const reader = getBuildSuiteReader();
          return reader.available
            ? await reader.clientEmailForProject(scope, project.buildsuiteProjectId).catch(() => null)
            : null;
        })()
      : (input.crew.find((m) => m.id === assignee.membershipId)?.email ?? null);

  const profile = await resolveContractorProfile(scope).catch(() => null);
  const companyName = (await resolveContractorName(scope).catch(() => null)) ?? '';
  const recipients = appointmentRecipients({
    contractor: { email: profile?.email ?? realIdentity(session).email, name: companyName || session.name },
    assignee,
    assigneeEmail,
  });

  const base = await appUrl();
  const when = appointmentWhen(appointment.startsAt, appointment.endsAt);
  const results: { audience: string; sent: boolean; reason?: string }[] = [];
  for (const r of recipients) {
    const { subject, html } = appointmentEmail({
      audience: r.audience,
      companyName,
      // The homeowner is given the code on their contract, never the award code.
      projectReference:
        (r.audience === 'homeowner' ? clientCode(project) : contractorCode(project)) ?? '',
      title: appointment.title,
      when,
      status: appointment.status,
      assigneeLabel: assignee.label,
      notes: appointment.notes,
      openUrl:
        r.audience === 'contractor'
          ? `${base}/dashboard/projects/${encodeURIComponent(project.buildsuiteProjectId)}/schedule`
          : r.audience === 'crew'
            ? `${base}/field`
            : null,
    });
    const sent = await mail.email.send({
      email: r.email,
      name: r.name,
      subject,
      html,
      source: 'Project Hub appointment',
    });
    results.push(sent.sent ? { audience: r.audience, sent: true } : { audience: r.audience, sent: false, reason: sent.reason });
  }

  if (results.some((r) => r.reason === 'disabled')) {
    return `Saved. Not emailed: email sending is off (GHL_SEND_EMAIL), so tell ${who} and yourself directly.`;
  }
  const reachedYou = results.some((r) => r.audience === 'contractor' && r.sent);
  const reachedThem = results.some((r) => r.audience !== 'contractor' && r.sent);
  const failed = results.filter((r) => !r.sent).length;
  // No usable address for them at all. (The same address as yours is not this:
  // they were deduplicated into your copy.)
  const noAddress = assigneeEmail === null || !assigneeEmail.includes('@');

  const parts: string[] = [];
  if (reachedYou && reachedThem) parts.push(`Emailed to you and ${who}.`);
  else if (reachedThem) parts.push(`Emailed to ${who}.`);
  else if (reachedYou) parts.push('Emailed to you.');
  if (noAddress) parts.push(`${who === 'the homeowner' ? 'The homeowner has' : `${who} has`} no email address on file, so they were not emailed.`);
  if (failed > 0) parts.push(`${failed === 1 ? 'One email' : `${failed} emails`} did not send — let them know directly.`);
  if (!profile?.email && !realIdentity(session).email) parts.push('Your account has no email address, so no copy was sent to you.');
  return parts.length === 0 ? 'Saved.' : `Saved. ${parts.join(' ')}`;
}

/** A posted assignee key this contractor was not offered. */
function refuseUnknownAssignee(resolved: ResolvedAssignee): void {
  if (resolved.kind === 'unknown') {
    throw new Error('that person is not on this project any more — reload the schedule and choose again');
  }
}

export async function createScheduleItem(
  _previous: { notice?: string } | undefined,
  formData: FormData,
): Promise<{ notice?: string } | undefined> {
  const { session, scope, schedule } = await scheduleContext();
  assertCan(session.role, 'create', 'schedule');

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  if (title.trim() === '') throw new Error('an appointment needs a title');

  const { project, choices, crew } = await schedulePeople(scope, projectId);
  const resolved = resolveAssignee(choices, String(formData.get('assignee') ?? ''));
  refuseUnknownAssignee(resolved);

  const appointment = {
    title: title.trim(),
    startsAt: optionalDateTime(formData.get('startsAt')),
    endsAt: optionalDateTime(formData.get('endsAt')),
    status: String(formData.get('status') ?? 'Scheduled'),
    notes: String(formData.get('notes') ?? ''),
  };

  await schedule.create(
    scope,
    {
      projectId,
      ...appointment,
      // Optional. A readable label, never an address — see schedule-assignees.
      trade: resolved.kind === 'person' ? resolved.assignee.label : '',
      // Never released on creation. The contractor decides when a homeowner
      // sees a date, and a checkbox that defaults to on would publish work
      // nobody had confirmed.
      clientVisible: false,
    },
    { name: session.name },
  );

  // Emailed after the save, and reported back to the form rather than through a
  // redirect — see `components/notice-form.tsx` for why.
  const notice =
    resolved.kind === 'person' && shouldNotify(null, resolved)
      ? await emailAppointment({ session, scope, project, assignee: resolved.assignee, crew, appointment })
      : undefined;
  revalidatePath(`/dashboard/projects/${projectId}/schedule`);
  return notice === undefined ? undefined : { notice };
}

export async function updateScheduleItem(
  _previous: { notice?: string } | undefined,
  formData: FormData,
): Promise<{ notice?: string } | undefined> {
  const { session, scope, schedule } = await scheduleContext();
  assertCan(session.role, 'update', 'schedule');

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '') throw new Error('itemId is required');

  const { project, choices, crew } = await schedulePeople(scope, projectId);
  // The stored row, read through the tenant — what the tag WAS decides whether
  // anyone is emailed, and a hidden form field would let a stale page decide.
  const existing = (await schedule.listForProject(scope, projectId)).find((i) => i.id === itemId);
  if (existing === undefined) throw new Error('that appointment is not on this project');

  const resolved = resolveAssignee(choices, String(formData.get('assignee') ?? ''));
  refuseUnknownAssignee(resolved);

  const appointment = {
    title: String(formData.get('title') ?? ''),
    startsAt: optionalDateTime(formData.get('startsAt')),
    endsAt: optionalDateTime(formData.get('endsAt')),
    status: String(formData.get('status') ?? 'Scheduled'),
    notes: String(formData.get('notes') ?? ''),
  };

  await schedule.update(
    scope,
    itemId,
    {
      ...appointment,
      // `keep` is a value typed before the dropdown existed: left exactly as it
      // was, so saving a date change does not wipe it.
      ...(resolved.kind === 'keep'
        ? {}
        : { trade: resolved.kind === 'person' ? resolved.assignee.label : '' }),
      // An unchecked box submits nothing, so this is read as a presence test.
      // Reading only the present keys would make un-releasing a no-op.
      clientVisible: formData.get('clientVisible') !== null,
    },
    { name: session.name },
  );

  const notice =
    resolved.kind === 'person' && shouldNotify(existing.trade, resolved)
      ? await emailAppointment({ session, scope, project, assignee: resolved.assignee, crew, appointment })
      : undefined;
  revalidatePath(`/dashboard/projects/${projectId}/schedule`);
  return notice === undefined ? undefined : { notice };
}

export async function archiveScheduleItem(formData: FormData) {
  const { session, scope, schedule } = await scheduleContext();
  assertCan(session.role, 'archive', 'schedule');

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '') throw new Error('itemId is required');

  await schedule.archive(scope, itemId, { name: session.name });
  revalidatePath(`/dashboard/projects/${projectId}/schedule`);
}

// ── Tasks: the contractor assigns work to the crew (2026-09-17) ─────────────
//
// `hub_tasks` has had `assigned_to`, `pm_note` and the seen/unseen "ding" since
// 0001, and the crew's Tasks screen shows what is assigned to them — but nothing
// ever created a task, so that screen was always empty. See task-assignment.ts.

async function taskContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const hub = getHubOperational();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { session, scope: await actionTenantScope(session), ops: hub.ops };
}

/**
 * The project, through the contractor's own scope, and the crew a task on it
 * can be given to — the same list People shows for the project.
 */
async function taskPeople(scope: TenantScope, projectId: string) {
  const project = await (await currentDataSource(scope)).getProject(scope, projectId);
  if (project === null) throw new Error('that project is not one of yours');
  const team = getHubTeam();
  const crew = team.available ? await team.team.listForProject(scope, projectId).catch(() => []) : [];
  return { project, options: assignableCrew(crew) };
}

function refuseUnknownTaskAssignee(who: TaskAssignee): void {
  if (who.kind === 'unknown') {
    throw new Error('that person is not on this project’s crew any more — reload and choose again');
  }
}

function revalidateTasks(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/tasks`);
  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath('/field');
  revalidatePath('/field/tasks');
}

export async function createProjectTask(
  _previous: { notice?: string } | undefined,
  formData: FormData,
): Promise<{ notice?: string } | undefined> {
  const { session, scope, ops } = await taskContext();
  // Handing out work is the office's act. The matrix gives `create` on tasks to
  // the contractor alone — `update` is shared with the crew, who start and
  // finish their own work, and must not be able to reassign it.
  assertCan(session.role, 'create', 'task');

  const projectId = String(formData.get('projectId') ?? '');
  const taskName = String(formData.get('taskName') ?? '').trim();
  if (projectId === '') throw new Error('projectId is required');
  if (taskName === '') throw new Error('a task needs a name');

  const { options } = await taskPeople(scope, projectId);
  const who = resolveTaskAssignee(options, String(formData.get('assignedTo') ?? ''));
  // A new task has nobody to keep.
  refuseUnknownTaskAssignee(who.kind === 'keep' ? { kind: 'unknown' } : who);

  const trade = String(formData.get('assignedTrade') ?? '').trim();
  const note = String(formData.get('pmNote') ?? '').trim();
  const date = String(formData.get('scheduledDate') ?? '').trim();

  await ops.createTask(scope, {
    projectId,
    taskName,
    assignedTo: who.kind === 'crew' ? who.member.id : undefined,
    assignedTrade: trade === '' ? undefined : trade,
    pmNote: note === '' ? undefined : note,
    scheduledDate: date === '' ? undefined : date,
    createdBy: session.name,
  });

  revalidateTasks(projectId);
  return {
    notice:
      who.kind === 'crew'
        ? `Assigned to ${who.member.label}. It is on their Tasks screen now, marked new until they open it.`
        : 'Saved as unassigned. Assign it to someone to put it on their Tasks screen.',
  };
}

export async function updateProjectTask(
  _previous: { notice?: string } | undefined,
  formData: FormData,
): Promise<{ notice?: string } | undefined> {
  const { session, scope, ops } = await taskContext();
  // Reassigning is handing out work too — see createProjectTask.
  assertCan(session.role, 'create', 'task');

  const projectId = String(formData.get('projectId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  if (projectId === '' || taskId === '') throw new Error('projectId and taskId are required');

  const { options } = await taskPeople(scope, projectId);
  // The stored task, read through the tenant: who it WAS with decides whether
  // this is a new assignment, and a hidden form field would let a stale page
  // decide that.
  const existing = (await ops.listTasks(scope, projectId)).find((t) => t.id === taskId);
  if (existing === undefined) throw new Error('that task is not on this project');

  const who = resolveTaskAssignee(options, String(formData.get('assignedTo') ?? ''));
  refuseUnknownTaskAssignee(who);
  const assignment = assignmentChange(existing.assignedTo, who, new Date().toISOString());

  const postedStatus = String(formData.get('status') ?? '');
  const date = String(formData.get('scheduledDate') ?? '').trim();

  await ops.updateTask(scope, taskId, {
    taskName: String(formData.get('taskName') ?? ''),
    pmNote: String(formData.get('pmNote') ?? ''),
    assignedTrade: String(formData.get('assignedTrade') ?? ''),
    scheduledDate: date === '' ? null : date,
    // Only a status from the fixed list; anything else keeps what was there.
    status: isTaskStatus(postedStatus) ? postedStatus : existing.status,
    assignment,
  });

  revalidateTasks(projectId);
  if (assignment === null) return { notice: 'Saved.' };
  return {
    notice:
      who.kind === 'crew'
        ? `Saved and assigned to ${who.member.label}. It shows as new on their Tasks screen.`
        : 'Saved and unassigned. It has left the crew’s Tasks screen.',
  };
}

export async function archiveProjectTask(formData: FormData) {
  const { session, scope, ops } = await taskContext();
  assertCan(session.role, 'archive', 'task');

  const projectId = String(formData.get('projectId') ?? '');
  const taskId = String(formData.get('taskId') ?? '');
  if (taskId === '') throw new Error('taskId is required');

  await ops.archiveTask(scope, taskId, { name: session.name });
  revalidateTasks(projectId);
}

// ── Milestones (§6.2) ───────────────────────────────────────────────────────
//
// `hub_milestones` and `createMilestone` have both existed for days; nothing
// called them. Same three gates as the schedule: the route refuses non-
// contractors, `assertCan` checks the matrix, the query filters on the tenant.

async function milestoneContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const hub = getHubOperational();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { session, scope: await actionTenantScope(session), ops: hub.ops };
}

function optionalDate(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

export async function createMilestone(formData: FormData) {
  const { session, scope, ops } = await milestoneContext();
  assertCan(session.role, 'create', 'milestone');

  const projectId = String(formData.get('projectId') ?? '');
  const milestoneName = String(formData.get('milestoneName') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  if (milestoneName.trim() === '') throw new Error('a milestone needs a name');

  const rawSequence = Number(formData.get('sequence') ?? 0);

  await ops.createMilestone(scope, {
    projectId,
    milestoneName,
    sequence: Number.isFinite(rawSequence) ? rawSequence : 0,
    plannedStart: optionalDate(formData.get('plannedStart')) ?? undefined,
    plannedEnd: optionalDate(formData.get('plannedEnd')) ?? undefined,
    // Internal until released, same as a schedule item.
    clientVisible: false,
    createdBy: session.name,
  });

  revalidatePath(`/dashboard/projects/${projectId}/timeline`);
}

export async function updateMilestone(formData: FormData) {
  const { session, scope, ops } = await milestoneContext();
  assertCan(session.role, 'update', 'milestone');

  const milestoneId = String(formData.get('milestoneId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (milestoneId === '') throw new Error('milestoneId is required');

  const rawSequence = Number(formData.get('sequence') ?? 0);

  await ops.updateMilestone(scope, milestoneId, {
    milestoneName: String(formData.get('milestoneName') ?? ''),
    sequence: Number.isFinite(rawSequence) ? rawSequence : 0,
    // A fixed vocabulary (Chris, open question since 10 Sep, proposed 14 Sep):
    // Not Started, In Progress, Completed, Blocked. Anything else is refused
    // rather than stored as free text the client tracker cannot colour.
    status: (() => {
      const raw = String(formData.get('status') ?? 'Not Started');
      if (!isMilestoneStatus(raw)) {
        throw new Error(`"${raw}" is not a milestone status. Use one of: ${MILESTONE_STATUSES.join(', ')}.`);
      }
      return raw;
    })(),
    plannedStart: optionalDate(formData.get('plannedStart')),
    plannedEnd: optionalDate(formData.get('plannedEnd')),
    // Presence test: an unchecked box submits nothing, and reading only the
    // present keys would make un-releasing a milestone a no-op.
    clientVisible: formData.get('clientVisible') !== null,
  });

  revalidatePath(`/dashboard/projects/${projectId}/timeline`);
}

export async function archiveMilestone(formData: FormData) {
  const { session, scope, ops } = await milestoneContext();
  assertCan(session.role, 'archive', 'milestone');

  const milestoneId = String(formData.get('milestoneId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (milestoneId === '') throw new Error('milestoneId is required');

  await ops.archiveMilestone(scope, milestoneId, { name: session.name });
  revalidatePath(`/dashboard/projects/${projectId}/timeline`);
}

// ── Documents and photos (§6.10 / §6.11) ────────────────────────────────────
//
// Both tables have existed since 0001 and nothing wrote either. `storage.ts`
// could already put a file in the bucket; nothing wrote the row saying which
// project it belonged to, so an uploaded file was unreachable.

async function mediaContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const hub = getHubMedia();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { session, scope: await actionTenantScope(session), media: hub.media };
}

/**
 * Upload a file and record it, in that order.
 *
 * The file goes to the bucket FIRST. If that fails nothing is written, so there
 * is no row pointing at a file that does not exist — a document that lists but
 * will not open reads as data loss, and is worse than a failed upload the
 * contractor can retry.
 *
 * A link is the alternative for anything we do not host, and needs no upload.
 */
export async function attachProjectFile(formData: FormData) {
  const { session, scope, media } = await mediaContext();

  const kind = String(formData.get('kind') ?? '') as 'document' | 'photo';
  if (kind !== 'document' && kind !== 'photo') throw new Error('kind must be document or photo');
  assertCan(session.role, 'create', kind);

  const projectId = String(formData.get('projectId') ?? '');
  if (projectId === '') throw new Error('projectId is required');

  const label = String(formData.get('label') ?? '');
  const externalUrl = String(formData.get('externalUrl') ?? '').trim();
  const file = formData.get('file');

  let storagePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const storage = getHubStorage();
    if (!storage.available) {
      throw new Error(`file storage is not connected (missing ${storage.missing.join(', ')})`);
    }
    const stored = await storage.storage.upload(scope, {
      projectId,
      kind: kind === 'document' ? 'documents' : 'photos',
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      body: await file.arrayBuffer(),
    });
    storagePath = stored.path;
  }

  if (storagePath === null && externalUrl === '') {
    throw new Error('choose a file to upload, or paste a link');
  }

  await media.attach(
    scope,
    kind,
    {
      projectId,
      // A photo with no caption is fine; a document with no title is not, and
      // the repository enforces that rather than this form.
      label: label || (file instanceof File ? file.name : ''),
      // Documents are filed into a folder. A form that somehow sends none
      // lands in the general field folder rather than nowhere, so the file is
      // never invisible to the crew and never accidentally client-side.
      category:
        kind === 'document'
          ? String(formData.get('category') ?? '').trim() || DEFAULT_FOLDER
          : String(formData.get('category') ?? ''),
      storagePath,
      externalUrl: externalUrl || null,
      clientVisible: false,
    },
    { name: session.name },
  );

  revalidatePath(`/dashboard/projects/${projectId}/${kind === 'document' ? 'documents' : 'photos'}`);
}

export async function updateProjectFile(formData: FormData) {
  const { session, scope, media } = await mediaContext();

  const kind = String(formData.get('kind') ?? '') as 'document' | 'photo';
  if (kind !== 'document' && kind !== 'photo') throw new Error('kind must be document or photo');
  assertCan(session.role, 'update', kind);

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '') throw new Error('itemId is required');

  const requestedFolder = String(formData.get('category') ?? '').trim();
  let clientVisible = formData.get('clientVisible') !== null;
  let category = requestedFolder;

  if (kind === 'document') {
    // The two folder rules, enforced here and not only in the form. A hand
    // rolled POST is the case that matters: the UI hides the release switch on
    // a field folder, and this makes hiding it more than a suggestion.
    if (isFieldFolder(requestedFolder)) clientVisible = false;
    // Releasing a document IS filing it under Client. Leaving it where it was
    // would mean a released row sitting in a trade folder, which the homeowner
    // gate refuses anyway — the file would simply never appear.
    if (clientVisible) category = CLIENT_FOLDER;
  }

  await media.update(scope, kind, itemId, {
    label: String(formData.get('label') ?? ''),
    // An empty folder means "leave it where it is" — the Unsorted rows offer a
    // placeholder option, and choosing nothing must not blank the category.
    ...(category === '' ? {} : { category }),
    clientVisible,
  });

  revalidatePath(`/dashboard/projects/${projectId}/${kind === 'document' ? 'documents' : 'photos'}`);
}

export async function archiveProjectFile(formData: FormData) {
  const { session, scope, media } = await mediaContext();

  const kind = String(formData.get('kind') ?? '') as 'document' | 'photo';
  if (kind !== 'document' && kind !== 'photo') throw new Error('kind must be document or photo');
  assertCan(session.role, 'archive', kind);

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '') throw new Error('itemId is required');

  await media.archive(scope, kind, itemId, { name: session.name });
  revalidatePath(`/dashboard/projects/${projectId}/${kind === 'document' ? 'documents' : 'photos'}`);
}

// ── Selections and change orders (§6.5 / §6.6) ──────────────────────────────
//
// The last two of the six screens that existed and did nothing. These are the
// only two whose tables did not exist; 0009 creates them.

async function selectionsContext() {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const hub = getHubSelections();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { session, scope: await actionTenantScope(session), repo: hub.selections };
}

/**
 * A money field from a form.
 *
 * Blank is null, not zero — "no allowance recorded" and "an allowance of £0"
 * are different claims, and the second one appears on a client's screen.
 */
function optionalMoney(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  const parsed = Number(text.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`"${text}" is not an amount`);
  return parsed;
}

export async function createSelection(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'create', 'selection');

  const projectId = String(formData.get('projectId') ?? '');
  await repo.createSelection(
    scope,
    {
      projectId,
      selectionName: String(formData.get('selectionName') ?? ''),
      category: String(formData.get('category') ?? ''),
      roomOrArea: String(formData.get('roomOrArea') ?? ''),
      allowance: optionalMoney(formData.get('allowance')),
      actualCost: optionalMoney(formData.get('actualCost')),
      upgradeAmount: optionalMoney(formData.get('upgradeAmount')),
      status: String(formData.get('status') ?? 'Pending'),
    },
    { name: session.name },
  );

  revalidatePath(`/dashboard/projects/${projectId}/designs`);
}

export async function updateSelection(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'update', 'selection');

  const selectionId = String(formData.get('selectionId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (selectionId === '') throw new Error('selectionId is required');

  await repo.updateSelection(scope, selectionId, {
    selectionName: String(formData.get('selectionName') ?? ''),
    category: String(formData.get('category') ?? ''),
    roomOrArea: String(formData.get('roomOrArea') ?? ''),
    allowance: optionalMoney(formData.get('allowance')),
    actualCost: optionalMoney(formData.get('actualCost')),
    upgradeAmount: optionalMoney(formData.get('upgradeAmount')),
    status: String(formData.get('status') ?? 'Pending'),
    clientVisible: formData.get('clientVisible') !== null,
  });

  revalidatePath(`/dashboard/projects/${projectId}/designs`);
}

export async function archiveSelection(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'archive', 'selection');

  const selectionId = String(formData.get('selectionId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (selectionId === '') throw new Error('selectionId is required');

  await repo.archiveSelection(scope, selectionId, { name: session.name });
  revalidatePath(`/dashboard/projects/${projectId}/designs`);
}

export async function createChangeOrder(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'create', 'changeOrder');

  const projectId = String(formData.get('projectId') ?? '');
  await repo.createChangeOrder(
    scope,
    {
      projectId,
      changeOrderNumber: String(formData.get('changeOrderNumber') ?? ''),
      title: String(formData.get('title') ?? ''),
      description: String(formData.get('description') ?? ''),
      reason: String(formData.get('reason') ?? ''),
      addedCost: optionalMoney(formData.get('addedCost')) ?? 0,
      creditAmount: optionalMoney(formData.get('creditAmount')) ?? 0,
      scheduleImpactDays: Number(formData.get('scheduleImpactDays') ?? 0) || 0,
      status: String(formData.get('status') ?? 'Draft'),
    },
    { name: session.name },
  );

  revalidatePath(`/dashboard/projects/${projectId}/change-orders`);
}

export async function updateChangeOrder(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'update', 'changeOrder');

  const changeOrderId = String(formData.get('changeOrderId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (changeOrderId === '') throw new Error('changeOrderId is required');

  // What the row looked like before this save, so the homeowner is emailed
  // once, when the order first goes to them, not on every later edit.
  const before = (await repo.listChangeOrders(scope, projectId)).find((c) => c.id === changeOrderId);
  const wasWithClient = before !== undefined && before.status === 'Awaiting Client' && before.clientVisible;

  await repo.updateChangeOrder(scope, changeOrderId, {
    title: String(formData.get('title') ?? ''),
    description: String(formData.get('description') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    addedCost: optionalMoney(formData.get('addedCost')) ?? 0,
    creditAmount: optionalMoney(formData.get('creditAmount')) ?? 0,
    scheduleImpactDays: Number(formData.get('scheduleImpactDays') ?? 0) || 0,
    status: String(formData.get('status') ?? 'Draft'),
    clientVisible: formData.get('clientVisible') !== null,
  });

  const nowWithClient =
    String(formData.get('status') ?? 'Draft') === 'Awaiting Client' && formData.get('clientVisible') !== null;
  if (nowWithClient && !wasWithClient) {
    const project = await (await currentDataSource(scope)).getProject(scope, projectId);
    if (project !== null) {
      const added = optionalMoney(formData.get('addedCost')) ?? 0;
      const credit = optionalMoney(formData.get('creditAmount')) ?? 0;
      await notifyHomeowner(scope, project, {
        kind: 'changeOrder',
        number: before?.changeOrderNumber ?? '',
        title: String(formData.get('title') ?? ''),
        netAmount: added - credit + (before?.tax ?? 0),
        scheduleImpactDays: Number(formData.get('scheduleImpactDays') ?? 0) || 0,
      });
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}/change-orders`);
}

export async function archiveChangeOrder(formData: FormData) {
  const { session, scope, repo } = await selectionsContext();
  assertCan(session.role, 'archive', 'changeOrder');

  const changeOrderId = String(formData.get('changeOrderId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (changeOrderId === '') throw new Error('changeOrderId is required');

  await repo.archiveChangeOrder(scope, changeOrderId, { name: session.name });
  revalidatePath(`/dashboard/projects/${projectId}/change-orders`);
}

// ── The client's answer (§6.5 / §6.6) ───────────────────────────────────────
//
// D4 §5: "the client approves, comments and reports." Until now the portal had
// zero server actions across all thirteen screens — a homeowner could read
// everything and do nothing, including answer a change order sent to them
// explicitly for a decision.
//
// This is the only write a client makes. It is scoped by the PROJECT they were
// already authorized to read, not by a tenant scope they do not hold.

export async function recordClientDecision(formData: FormData) {
  const session = await getSession();
  if (session === null) throw new Error('not signed in');

  const kind = String(formData.get('kind') ?? '') as 'selection' | 'changeOrder';
  if (kind !== 'selection' && kind !== 'changeOrder') {
    throw new Error('kind must be selection or changeOrder');
  }
  // The matrix already grants `approve` to a client; nothing had ever called
  // it. A contractor may also answer, recording a decision taken by phone.
  assertCan(session.role, 'approve', kind);

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '' || projectId === '') throw new Error('itemId and projectId are required');

  const hub = getHubSelections();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }

  // The project is the authority. `clientProjectsFor` returns only the projects
  // this person may see, so a project id they were not given resolves to
  // nothing and the decision is refused — a homeowner cannot answer on another
  // homeowner's job by editing a hidden field.
  const access = await requireAccess();
  const db = await currentDataSource();
  const mine = await clientProjectsFor(access, db);
  const project = mine.find((p) => p.buildsuiteProjectId === projectId);
  if (project === undefined) throw new Error('that project is not one of yours');

  // Filed under the project's contractor: the repository asserts one, and the
  // owner profile alone is not it.
  const decisionScope = await hubScopeOfProject(project);
  if (decisionScope === null) {
    throw new Error('this project is not linked to a contractor, so nothing can be filed under it');
  }
  await hub.selections.recordClientDecision(decisionScope, kind, itemId, {
    accepted: String(formData.get('decision') ?? '') === 'approve',
    comments: String(formData.get('comments') ?? ''),
  });

  revalidatePath(kind === 'selection' ? '/portal/designs' : '/portal/change-orders');
}
