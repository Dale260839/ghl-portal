'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { accountForEmail, clearSession, getSession, homeFor, setSession } from './session';
import {
  approveAndPublish,
  approveInternally,
  returnForRevision,
  saveClientSummary,
  submitToPm,
} from './data/mutations';

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
  });

  redirect(homeFor(account.role));
}

export async function signOut() {
  await clearSession();
  redirect('/');
}

/**
 * Field Update Review actions (§12.1), mapped onto the §10 state machine.
 * Contractor-only — a field user reaching these would be a §3.2 violation, so
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

  switch (action) {
    case 'publish':
      approveAndPublish(id, clientSummary);
      break;
    case 'internal':
      approveInternally(id, clientSummary);
      break;
    case 'return':
      returnForRevision(id);
      break;
    case 'save':
      saveClientSummary(id, clientSummary);
      break;
  }

  revalidatePath('/dashboard/updates');
  revalidatePath('/dashboard');
  revalidatePath('/portal');
}

/** WF3 — field submits to the PM. Never notifies the client. */
export async function submitFieldUpdate(formData: FormData) {
  const session = await getSession();
  if (session?.role !== 'field' && session?.role !== 'contractor') {
    throw new Error('Only field users may submit daily updates');
  }

  submitToPm({
    projectId: String(formData.get('projectId') ?? ''),
    submittedBy: session.name,
    workCompleted: String(formData.get('workCompleted') ?? ''),
    internalNotes: String(formData.get('internalNotes') ?? ''),
    clientSummary: String(formData.get('clientSummary') ?? ''),
    crewOnsite: Number(formData.get('crewOnsite') ?? 0),
    hoursWorked: Number(formData.get('hoursWorked') ?? 0),
    weather: String(formData.get('weather') ?? ''),
  });

  revalidatePath('/field');
  revalidatePath('/dashboard/updates');
  redirect('/field?submitted=1');
}
