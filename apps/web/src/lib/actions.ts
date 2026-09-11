'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getBuildSuiteReader } from './buildsuite/projects.ts';
import type { ClientLoginReader } from './auth/client-lookup.ts';
import { clientIpFrom } from './auth/rate-limit.ts';
import {
  clientCodeLimiter,
  clientCodeMessage,
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
import { getHubStorage } from './hub-db/storage.ts';
import { getHubTeam, INVITABLE_ROLES, type InvitableRole } from './hub-db/team';
import { getHubInvoiceDrafts } from './hub-db/invoice-drafts';
import { resolveInvoiceRail, draftFromStored } from './invoicing/rail.ts';
import { resolveContractorProfile } from './buildsuite/contractor-identity.ts';
import { getProposalsReader } from './buildsuite/proposals';
import { paymentScheduleDrafts } from './payment-schedule';
import { GRANTABLE_RESOURCES } from './permissions';
import { accountSwitchEnabled, findDevAccount } from './dev-accounts';
import { appUrl } from './app-url';
import { getGhlEmail, invitationEmail } from './ghl/email';
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

export async function signIn(_prev: { error?: string } | undefined, formData: FormData) {
  // Two distinct field names on purpose. The demo radios are `email`; a real
  // account types `accountEmail`. Sharing one name would let a selected radio
  // shadow what someone typed, and they would be signed in as a demo identity
  // while believing they had used their own credentials.
  const password = String(formData.get('password') ?? '');
  const email = String(formData.get('accountEmail') ?? '') || String(formData.get('email') ?? '');

  // Real invited users first. Someone who set a password through an invitation
  // must be able to come back, and their account takes precedence over any
  // demo identity that happens to share an email.
  if (password !== '') {
    const hub = getHubTeam();
    if (hub.available) {
      const result = await hub.team.authenticate(email, password);
      if (result.ok) {
        const m = result.membership;
        await setSession({
          role: m.role,
          name: m.fullName === '' ? m.email : m.fullName,
          email: m.email,
          membershipId: m.id,
          // The BuildSuite profiles this member reads under, from the
          // membership row. A contractor and a field member carry the
          // contractor's profiles; a client carries none, because their access
          // is their projects plus the gate and BuildSuite stays closed to them.
          //
          // It used to be `[m.contractorId]`, which put a contractor id where an
          // auth profile id belongs — the same conflation that hid a
          // contractor's own records on 2026-09-01.
          authProfileIds: m.authProfileIds,
          // No `contactId` for a client. A membership id is not a GoHighLevel
          // contact id, and putting one there sent the portal looking up a
          // contact that does not exist; see `lib/client-scope.ts`.
        } as Session);
        redirect(homeFor(m.role));
      }

      if (result.reason === 'revoked') {
        return { error: 'This account no longer has access. Ask your contractor to restore it.' };
      }
      if (result.reason === 'not-activated') {
        return { error: 'Finish setting up your account using the invitation link first.' };
      }
      // 'unknown' falls through to the demo path rather than answering here,
      // so a wrong password and an unknown email look identical.
    }
  }

  const account = accountForEmail(email);
  if (account === undefined) {
    return { error: 'We could not sign you in. Check the email and password.' };
  }

  // Demo build: the demo identities have no password. Real auth for staff is
  // GHL portal login (§9.2); real auth for invited users is the branch above.
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
  const session = await getSession();
  if (session === null) throw new Error('not signed in');
  // §12.2 — the crew writes updates. Note this is `create`, not `publish`.
  assertCan(session.role, 'create', 'dailyUpdate');

  const projectId = String(formData.get('projectId') ?? '');
  const blocker = String(formData.get('blocker') ?? '');

  // Built by `actionTenantScope`, not by hand. Assembling it here read
  // `session.ghlLocationId`, which an invited crew member does not have — so
  // submitting an update threw `refusing an unscoped read of submit update`
  // for exactly the people the screen is for.
  const fieldScope = await actionTenantScope(session);

  // Goes to the Hub's database when there is one. It used to go to an in-memory
  // array that the read path never consulted, so submitting did nothing
  // visible and anything that worked vanished on restart.
  //
  // NOTE the client summary is NOT taken from this form. A crew member writes
  // what happened; the PM writes what the homeowner reads. Accepting a
  // clientSummary here would let the field set client-facing text directly,
  // which is the one thing the whole approval model exists to prevent.
  const updateId = await currentWriter().createUpdate(fieldScope, {
    projectId,
    submittedBy: session.name,
    workCompleted: String(formData.get('workCompleted') ?? ''),
    internalNotes: String(formData.get('internalNotes') ?? ''),
    crewOnsite: Number(formData.get('crewOnsite') ?? 0),
    hoursWorked: Number(formData.get('hoursWorked') ?? 0),
    weather: String(formData.get('weather') ?? ''),
    blocker,
    clientDecisionNeeded: formData.get('clientDecisionNeeded') === 'on',
  });
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

export async function inviteTeamMember(formData: FormData) {
  const { scope, team, actor } = await teamContext();

  const role = String(formData.get('role') ?? '');
  if (!(INVITABLE_ROLES as readonly string[]).includes(role)) {
    throw new Error(`${role} is not a role a contractor can invite`);
  }

  // Which projects this person gets. Checked against the projects the
  // contractor actually has rather than trusted from the form: `formData` is
  // whatever was posted, and an id pasted in by hand must not hand someone
  // access to another contractor's job.
  const requested = new Set(formData.getAll('projectIds').map((v) => String(v)));
  const projectIds =
    requested.size === 0
      ? []
      : (await (await currentDataSource(scope)).listProjects(scope))
          .map((p) => p.buildsuiteProjectId)
          .filter((id) => requested.has(id));

  const result = await team.invite(
    scope,
    {
      email: String(formData.get('email') ?? ''),
      fullName: String(formData.get('fullName') ?? ''),
      role: role as InvitableRole,
      projectIds,
    },
    actor,
    // The host this request came in on, so the link works wherever the app is
    // running. Previously a fixed env var, which sent a localhost link.
    await appUrl(),
  );

  // Send it. GoHighLevel rather than a new provider: it already holds the
  // contact, and a reply lands in the thread the contractor already uses.
  let delivery = 'none';
  // Addressed to the contractor's own sub-account, not the deployment's.
  const mail = getGhlEmail(scope.locationId);
  if (mail.available) {
    const { subject, html } = invitationEmail({
      inviterName: actor.name,
      companyName: String(formData.get('companyName') ?? ''),
      role: role as InvitableRole,
      acceptUrl: result.acceptUrl,
    });
    const sent = await mail.email.send({
      email: result.membership.email,
      name: result.membership.fullName,
      subject,
      html,
    });
    delivery = sent.sent ? 'sent' : sent.reason;
  }

  revalidatePath('/dashboard/team');
  // The link comes back on the URL regardless of whether the email went. If
  // sending is off or failed, the contractor can still send it themselves —
  // and if it succeeded, they can still see what the person was sent.
  redirect(
    `/dashboard/team?invited=${encodeURIComponent(result.membership.email)}&link=${encodeURIComponent(result.acceptUrl)}&delivery=${delivery}`,
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

/**
 * The homeowner's sign-in: email plus the project code from their contract.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MINTS A SESSION WHERE `requestSignIn` MINTS AN EMAIL
 *
 * Chris, 2026-09-10: signing the contract fires a BuildSuite automation that
 * sends the homeowner their project code, and that code is the password. There
 * is no invitation to wait for and no link to expire, which is the point — the
 * whole path is automatic from signature to first login.
 *
 * The policy is in `auth/client-credentials.ts` and is tested without a
 * database. This function is only the wiring: the live reader, the live store,
 * the caller's IP, and the cookie at the end.
 *
 * BOTH DEPENDENCIES MUST BE LIVE. An unavailable BuildSuite must never become
 * an unauthenticated sign-in, so a missing reader or a missing Hub reports an
 * outage rather than falling through to anything — there is deliberately no
 * fixture path here at all.
 * ---------------------------------------------------------------------------
 */
export async function signInWithCode(
  _prev: { message?: string } | undefined,
  formData: FormData,
): Promise<{ message: string }> {
  const email = String(formData.get('email') ?? '');
  const projectCode = String(formData.get('projectCode') ?? '');

  const buildsuite = getBuildSuiteReader();
  const hub = getHubTeam();
  if (!buildsuite.available || !hub.available) {
    return { message: clientCodeMessage({ result: 'unavailable' }) };
  }

  const reader: SignedProjectReader = buildsuite;
  const outcome = await signInWithProjectCode(email, projectCode, {
    reader,
    store: hub.team,
    limiter: clientCodeLimiter,
    ip: clientIpFrom(await headers()),
  });

  if (outcome.result !== 'signed-in') return { message: clientCodeMessage(outcome) };

  const m = outcome.membership;
  await setSession({
    role: 'client',
    name: m.fullName === '' ? m.email : m.fullName,
    email: m.email,
    membershipId: m.id,
    // EMPTY, and this is the privacy model rather than an oversight. A
    // homeowner reads only the Hub's own tables; a profile here would open
    // BuildSuite to them. `currentAccess` reads their projects from the
    // membership on every request, so revocation and assignment are live.
    authProfileIds: [],
    // No `contactId`. A contact id would send `clientProjectsFor` down the
    // contact path and return every project that contact holds — including
    // ones whose code this person has never proved.
  } as Session);

  redirect(homeFor('client'));
}

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
  const rail = resolveInvoiceRail(
    process.env,
    profile === null || profile.businessName === null
      ? undefined
      : {
          name: profile.businessName,
          logoUrl: profile.logoUrl,
          phone: profile.phone,
          website: profile.website,
          address: profile.address,
        },
    scope.locationId,
  );
  // The homeowner's email, read once for this purpose. Without it the rail
  // refuses (an invoice with nobody to send it to), which is what happened
  // on every attempt until 10 Sep: the recipient was built with email ''.
  const buildsuiteForEmail = getBuildSuiteReader();
  const clientEmail = buildsuiteForEmail.available
    ? await buildsuiteForEmail.clientEmailForProject(scope, draft.projectId)
    : null;

  const invoice = draftFromStored(draft, project);
  const result = await rail.createDraft(invoice, {
    ghlContactId: project.primaryContactId,
    name: project.clientName,
    // The address is not ours to supply — the rail attaches to the contact,
    // which already holds it. Passing one here would be a second source of
    // truth for where an invoice goes.
    email: clientEmail ?? '',
  });

  if (!result.created) {
    // An uncertain failure is NOT a failure a contractor should retry. The
    // invoice may already exist on the rail with no id on our side, and a
    // second click would make a real second invoice for the same instalment.
    // Send them to look rather than guessing on their behalf.
    if (result.uncertain === true) {
      throw new Error(
        `${rail.name} could not confirm this either way (${result.reason}). ` +
          'The invoice MAY have been created. Check GoHighLevel before trying again — ' +
          'creating it twice would invoice the homeowner twice.',
      );
    }
    throw new Error(`${rail.name} refused to create the invoice: ${result.reason}`);
  }

  await hub.drafts.recordRailCreation(
    scope,
    draftId,
    { name: result.rail, externalId: result.externalId, externalUrl: result.editUrl },
    { name: session.name },
  );

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

export async function createScheduleItem(formData: FormData) {
  const { session, scope, schedule } = await scheduleContext();
  assertCan(session.role, 'create', 'schedule');

  const projectId = String(formData.get('projectId') ?? '');
  const title = String(formData.get('title') ?? '');
  if (projectId === '') throw new Error('projectId is required');
  if (title.trim() === '') throw new Error('an appointment needs a title');

  await schedule.create(
    scope,
    {
      projectId,
      title,
      startsAt: optionalDateTime(formData.get('startsAt')),
      endsAt: optionalDateTime(formData.get('endsAt')),
      trade: String(formData.get('trade') ?? ''),
      status: String(formData.get('status') ?? 'Scheduled'),
      // Never released on creation. The contractor decides when a homeowner
      // sees a date, and a checkbox that defaults to on would publish work
      // nobody had confirmed.
      clientVisible: false,
      notes: String(formData.get('notes') ?? ''),
    },
    { name: session.name },
  );

  revalidatePath(`/dashboard/projects/${projectId}/schedule`);
}

export async function updateScheduleItem(formData: FormData) {
  const { session, scope, schedule } = await scheduleContext();
  assertCan(session.role, 'update', 'schedule');

  const itemId = String(formData.get('itemId') ?? '');
  const projectId = String(formData.get('projectId') ?? '');
  if (itemId === '') throw new Error('itemId is required');

  await schedule.update(
    scope,
    itemId,
    {
      title: String(formData.get('title') ?? ''),
      startsAt: optionalDateTime(formData.get('startsAt')),
      endsAt: optionalDateTime(formData.get('endsAt')),
      trade: String(formData.get('trade') ?? ''),
      status: String(formData.get('status') ?? 'Scheduled'),
      // An unchecked box submits nothing, so this is read as a presence test.
      // Reading only the present keys would make un-releasing a no-op.
      clientVisible: formData.get('clientVisible') !== null,
      notes: String(formData.get('notes') ?? ''),
    },
    { name: session.name },
  );

  revalidatePath(`/dashboard/projects/${projectId}/schedule`);
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
    status: String(formData.get('status') ?? 'Not Started'),
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
