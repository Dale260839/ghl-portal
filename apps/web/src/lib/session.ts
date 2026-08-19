import 'server-only';

import { cookies } from 'next/headers';

import { resolveSessionSecret, sign, verify } from './auth/session-crypto.ts';

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
  authProfileIds?: readonly string[];
  /** The GHL sub-account this session is working in (D-013). */
  ghlLocationId?: string;
}

const COOKIE = 'bs_session_hub';
const SESSION_TTL_SECONDS = 60 * 60 * 8;

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
    authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
    ghlLocationId: 'loc_alliance_pro',
    label: 'Contractor Dashboard',
    description: 'Project manager — creates and controls everything the other two views display',
  },
  {
    role: 'contractor',
    name: 'Priya Shah',
    email: 'priya@allianceproservices.com',
    // A different real owner — 6 active projects. Signing in as each in turn
    // shows the tenancy scoping working against live data.
    authProfileIds: ['a4502e38-bb67-420b-a7fc-3e1bc3d99c01'],
    ghlLocationId: 'loc_bexar_builders',
    label: 'Contractor Dashboard (second tenant)',
    description: 'A different contractor — proves the data is scoped, not global',
  },
  {
    role: 'field',
    name: 'Tony Alvarez',
    email: 'tony@allianceproservices.com',
    authProfileIds: ['7726102a-8e13-4006-889d-d68bc1cccd40'],
    ghlLocationId: 'loc_alliance_pro',
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
  const result = verify<Session>(raw, resolveSessionSecret());
  if (!result.valid) return null;

  const { role } = result.payload;
  if (role !== 'contractor' && role !== 'field' && role !== 'client') return null;
  return result.payload;
}

export async function setSession(session: Session): Promise<void> {
  const token = sign({ ...session }, resolveSessionSecret(), { ttlSeconds: SESSION_TTL_SECONDS });
  (await cookies()).set(COOKIE, token, {
    // Signed, so tampering is detectable — but still httpOnly and, in
    // production, Secure. Defence in depth: the signature is the guarantee,
    // these reduce how often it has to be relied on.
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
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
