'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountForEmail, clearSession, getSession, homeFor, setSession } from './session';
import { planReturn, planViewAs, realIdentity, viewAsEnabled } from './view-as';
import { demoToggleEnabled, setDemoData } from './demo-mode';
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
  if (session?.role !== 'contractor') {
    throw new Error('§3.2: only a project manager may review field updates');
  }

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
  if (session?.role !== 'contractor') {
    throw new Error('§9.1: only a contractor may change client visibility');
  }

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
  if (session?.role !== 'field' && session?.role !== 'contractor') {
    throw new Error('Only field users may submit daily updates');
  }

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
 * Demo data toggle (D-017, temporary scaffolding).
 *
 * Flips the whole app between real BuildSuite data and fixtures. It exists
 * because BuildSuite holds no field updates, so the review queue — the spine of
 * the client walkthrough — is empty on real data. See `lib/demo-mode.ts`.
 *
 * Contractor-only, checked here rather than trusted from the form: the control
 * being hidden is a UI fact, and this is a server action anyone can post to.
 */
export async function toggleDemoData(formData: FormData) {
  if (!demoToggleEnabled()) throw new Error('Demo data toggle is disabled');

  const session = await getSession();
  if (session === null) throw new Error('Sign in first');
  const real = realIdentity(session);
  if (real.role !== 'contractor') {
    throw new Error('Only a contractor account can switch demo data');
  }

  await setDemoData(formData.get('on') === 'true');

  // Every surface reads through the data source, so all of them change.
  revalidatePath('/', 'layout');
  redirect(String(formData.get('returnTo') ?? homeFor(session.role)));
}
