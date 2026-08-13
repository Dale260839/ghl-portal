import 'server-only';

import { cookies } from 'next/headers';

/**
 * DEMO AUTHENTICATION — placeholder, not a security boundary.
 *
 * Real auth is GHL portal login (§9.2), which is blocked on the integration
 * token and on confirming how a portal-authenticated contact is identified
 * server-side (see docs/PHASE-0.md §3). This module exists so the screens can
 * be built and demoed now; it is deliberately shaped like the real thing —
 * server-side session lookup, role, and an associated contact — so swapping in
 * GHL auth touches this file and nothing else.
 *
 * §9.2 still holds even here: the role determines which surfaces render, and
 * the client surfaces resolve their projects from the session's contact rather
 * than from anything supplied by the browser.
 */

export type Role = 'contractor' | 'field' | 'client';

export interface Session {
  role: Role;
  name: string;
  email: string;
  /** Client sessions only — the contact whose projects they may see. */
  contactId?: string;
  /**
   * BuildSuite's `auth_profiles.id` — the tenant key for contractor/field
   * sessions. Every BuildSuite read is scoped to it; a session without one can
   * read nothing (see `lib/tenancy.ts`).
   *
   * Real sessions will carry this from the GHL login (D-011). The demo accounts
   * below use real ids from the live database so the scoping is genuinely
   * demonstrated rather than simulated.
   */
  authProfileId?: string;
}

const COOKIE = 'bs_demo_session';

export interface DemoAccount extends Session {
  label: string;
  description: string;
}

/** The three sign-in identities offered on the login screen. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    role: 'contractor',
    name: 'Marcus Reyes',
    email: 'marcus@allianceproservices.com',
    // A real auth_profiles.id from the live database — 26 active projects.
    authProfileId: '7726102a-8e13-4006-889d-d68bc1cccd40',
    label: 'Contractor Dashboard',
    description: 'Project manager — creates and controls everything the other two views display',
  },
  {
    role: 'contractor',
    name: 'Priya Shah',
    email: 'priya@allianceproservices.com',
    // A different real owner — 6 active projects. Signing in as each in turn
    // shows the tenancy scoping working against live data.
    authProfileId: 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01',
    label: 'Contractor Dashboard (second tenant)',
    description: 'A different contractor — proves the data is scoped, not global',
  },
  {
    role: 'field',
    name: 'Tony Alvarez',
    email: 'tony@allianceproservices.com',
    authProfileId: '7726102a-8e13-4006-889d-d68bc1cccd40',
    label: 'Field Interface',
    description: 'Superintendent — submits updates and tasks, never publishes to the client',
  },
  {
    role: 'client',
    name: 'Dana Johnson',
    email: 'dana@example.com',
    contactId: 'contact-johnson',
    label: 'Client Portal',
    description: 'Homeowner with two active projects — sees only approved, published content',
  },
];

export function accountForEmail(email: string): DemoAccount | undefined {
  const normalized = email.trim().toLowerCase();
  return DEMO_ACCOUNTS.find((a) => a.email === normalized);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Session;
    if (parsed.role !== 'contractor' && parsed.role !== 'field' && parsed.role !== 'client') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setSession(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, JSON.stringify(session), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export function homeFor(role: Role): string {
  switch (role) {
    case 'contractor':
      return '/dashboard';
    case 'field':
      return '/field';
    case 'client':
      return '/portal';
  }
}
