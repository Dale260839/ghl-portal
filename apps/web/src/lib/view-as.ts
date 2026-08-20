import { DEMO_ACCOUNTS, homeFor, type Role, type Session } from './demo-accounts.ts';

/**
 * "View as" — temporary demo scaffolding (D-016).
 *
 * Field crews and homeowners have no way to sign in yet: contractors arrive
 * through a GoHighLevel menu link, which authenticates a sub-account, and the
 * invitation flow that would give the other two roles real accounts is designed
 * but unbuilt (`docs/kb/authentication-model.md`). Until it exists, the only way
 * to show the other two experiences on the deployed site is to let a contractor
 * assume them.
 *
 * **This is not a new privilege.** `/field` and `/portal` already admit a
 * contractor session — the portal even renders a "contractor preview" banner. The
 * switcher is a shortcut to something the app already permits, not a hole in it.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THAT MATTERS: assuming the field role **inherits the caller's own
 * tenant keys**, never the demo account's. A contractor scoped to one agency who
 * switched into a field view carrying a different `authProfileId` would be
 * looking at another company's jobs — a cross-tenant leak dressed up as a demo
 * feature. The client role carries no tenant key at all, because a client
 * resolves projects through a contact (§9.1) and a client session holding an
 * agency key would be a category error.
 * ---------------------------------------------------------------------------
 *
 * Remove this file when invitations ship. Nothing else depends on it.
 */

export interface ViewAsOption {
  role: Role;
  label: string;
  /** Who you become — the persona shown in the UI while the view is assumed. */
  persona: string;
  hint: string;
}

/**
 * The personas are the demo accounts, so switching lands you in the same
 * identity the login screen would have given you.
 */
function persona(role: Role): { name: string; email: string; contactId?: string } {
  const account = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (account === undefined) {
    throw new Error(`no demo persona defined for role "${role}"`);
  }
  return { name: account.name, email: account.email, contactId: account.contactId };
}

export const VIEW_AS_OPTIONS: ViewAsOption[] = [
  {
    role: 'contractor',
    label: 'Contractor Dashboard',
    persona: 'Your own account',
    hint: 'Full control — every project, cost, and approval',
  },
  {
    role: 'field',
    label: 'Field Interface',
    persona: persona('field').name,
    hint: 'Submits updates. Never publishes to the client',
  },
  {
    role: 'client',
    label: 'Client Portal',
    persona: persona('client').name,
    hint: 'Approved content only — no costs, no internal notes',
  },
];

export type ViewAsResult =
  | { ok: true; session: Session; redirectTo: string }
  | { ok: false; reason: string };

/**
 * The identity a session really belongs to.
 *
 * While a view is assumed, `returnTo` holds the real one — so re-basing from it
 * is what stops impersonation nesting. Switching client → field must start from
 * the contractor again, not stack a second layer that "Back to my account" would
 * only half unwind.
 */
export function realIdentity(session: Session): NonNullable<Session['returnTo']> {
  return (
    session.returnTo ?? {
      role: session.role,
      name: session.name,
      email: session.email,
      authProfileIds: session.authProfileIds,
      ghlLocationId: session.ghlLocationId,
    }
  );
}

export function isViewingAs(session: Session | null): boolean {
  return session?.returnTo !== undefined;
}

/**
 * Builds the session for an assumed view, or refuses.
 *
 * Pure — the caller writes the cookie. That keeps the tenancy rule above
 * testable without a request.
 */
export function planViewAs(current: Session | null, target: Role): ViewAsResult {
  if (current === null) {
    return { ok: false, reason: 'Sign in first.' };
  }

  const real = realIdentity(current);

  // Only a contractor may assume another view. Checked against the *real*
  // identity, so an assumed client view cannot be used to reach further.
  if (real.role !== 'contractor') {
    return { ok: false, reason: 'Only a contractor account can switch views.' };
  }

  if (target === 'contractor') {
    return planReturn(current);
  }

  if (target === 'field') {
    const { name, email } = persona('field');
    return {
      ok: true,
      session: {
        role: 'field',
        name,
        email,
        // Inherited, never the demo account's. See the block comment above.
        authProfileIds: real.authProfileIds,
        ghlLocationId: real.ghlLocationId,
        returnTo: real,
      },
      redirectTo: homeFor('field'),
    };
  }

  const { name, email, contactId } = persona('client');
  return {
    ok: true,
    session: {
      role: 'client',
      name,
      email,
      contactId,
      // Deliberately no tenant keys — a client is scoped by contact (§9.1).
      returnTo: real,
    },
    redirectTo: homeFor('client'),
  };
}

/** Restores the contractor identity an assumed view was taken from. */
export function planReturn(current: Session | null): ViewAsResult {
  if (current === null) {
    return { ok: false, reason: 'Sign in first.' };
  }

  const real = realIdentity(current);
  if (real.role !== 'contractor') {
    return { ok: false, reason: 'Only a contractor account can switch views.' };
  }

  return {
    ok: true,
    session: {
      role: real.role,
      name: real.name,
      email: real.email,
      authProfileIds: real.authProfileIds,
      ghlLocationId: real.ghlLocationId,
      // No `returnTo` — the view has been handed back.
    },
    redirectTo: homeFor(real.role),
  };
}

/**
 * Off switch.
 *
 * Defaults on, because the demo runs on the deployed site and one more required
 * environment variable is one more thing to forget. Set `DISABLE_VIEW_AS=true`
 * to hide it — worth doing the moment a real client account exists, at which
 * point this file should be deleted rather than disabled.
 */
export function viewAsEnabled(): boolean {
  return process.env.DISABLE_VIEW_AS !== 'true';
}
