/**
 * Session shape and the demo identities — deliberately free of `server-only`.
 *
 * `session.ts` owns the cookie and re-exports everything here, so call sites
 * still import from one place. The split exists because the *shape* of a session
 * is pure data that pure modules (`view-as.ts`) and `node --test` need to reason
 * about, while reading and writing one is a server-side act.
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
  /**
   * `hub_memberships.id`, for a user who arrived through an invitation rather
   * than through GoHighLevel.
   *
   * Its presence means access is re-checked on every request against the Hub
   * database — revocation and permission ticks take effect immediately rather
   * than at the next login. A session alone is never sufficient authority for
   * an invited user.
   */
  membershipId?: string;
  /**
   * Demo scaffolding (D-016) — the contractor identity this view was assumed
   * from, so "Back to my account" restores it exactly. Absent on a normal
   * session; its presence is what makes the impersonation banner render.
   */
  returnTo?: {
    role: Role;
    name: string;
    email: string;
    authProfileIds?: readonly string[];
    ghlLocationId?: string;
  };
}

export interface DemoAccount extends Session {
  label: string;
  description: string;
}

/** The sign-in identities offered on the login screen. */
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
