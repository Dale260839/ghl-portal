import 'server-only';

import { BuildSuiteClient, readBuildSuiteConfig } from './buildsuite/client.ts';

/**
 * Signing in as another contractor. **Development only.**
 *
 * ---------------------------------------------------------------------------
 * THIS IS AN IMPERSONATION SWITCH AND IT MUST NOT REACH PRODUCTION
 *
 * It hands anyone who can see it a session as any contractor on the account,
 * with their projects, their proposals, their prices and their team. That is
 * exactly what it is for while building — checking that tenancy actually
 * separates people needs two people to switch between — and exactly why it is
 * dangerous anywhere else.
 *
 * So it is **off unless explicitly enabled**, the inverse of `DISABLE_VIEW_AS`:
 * `ENABLE_ACCOUNT_SWITCH=true` and nothing else turns it on. A production
 * deployment that forgets to set anything gets no switch, which is the right
 * way round for a control like this. `view-as` can default on because it only
 * ever shows you your own data through another role's lens; this shows you
 * somebody else's data entirely.
 *
 * Delete it when real contractor sign-in exists. It is scaffolding.
 * ---------------------------------------------------------------------------
 */

export function accountSwitchEnabled(): boolean {
  return process.env.ENABLE_ACCOUNT_SWITCH === 'true';
}

export interface DevAccount {
  /** `auth_profiles.id` — what the session carries and BuildSuite filters on. */
  authProfileId: string;
  email: string;
  locationId: string;
  /** Present only when the profile resolves to a contractor record. */
  contractorId: string | null;
  businessName: string;
  /** False when nothing links this profile to a contractor. Shown, not hidden. */
  linked: boolean;
  /** `contractor` or `admin`. Shown, because an admin is not a contractor. */
  userType: string;
  /** Live proposals filed against this contractor. The reason to pick one. */
  liveWork: number;
}

interface ProfileRow {
  id: string;
  email: string | null;
  user_type: string | null;
  contractor_id: string | null;
  contact_id: string | null;
  location_id: string | null;
}

interface ContractorRow {
  id: string;
  business_name: string | null;
  full_name: string | null;
  email: string | null;
  ghl_contact_id: string | null;
}

/**
 * Every contractor account that could be signed in as.
 *
 * Resolves each profile the same three ways `contractor-identity.ts` does —
 * dedicated column, then GoHighLevel contact, then email — so the list shows
 * exactly what the real resolver would find. A profile that does not resolve is
 * **listed anyway, marked unlinked**: those seven are the interesting ones to
 * test with, because they are what a real unlinked contractor sees.
 */
export async function listDevAccounts(): Promise<DevAccount[]> {
  if (!accountSwitchEnabled()) return [];

  const config = readBuildSuiteConfig();
  if (!config.configured) return [];
  const client = new BuildSuiteClient(config.config);

  // `contractor` AND `admin`. Filtering to `contractor` alone excluded the one
  // account with signed work on it — ralph@alliance4contractors.com owns AFC and
  // is recorded as an admin, so the most useful account in the system was the
  // one the switcher would not show.
  const profiles = await client.select<ProfileRow>({
    from: 'auth_profiles',
    columns: ['id', 'email', 'user_type', 'contractor_id', 'contact_id', 'location_id'],
    filters: { user_type: 'in.(contractor,admin)' },
    limit: 200,
  });

  const contractors = await client.select<ContractorRow>({
    from: 'contractors',
    columns: ['id', 'business_name', 'full_name', 'email', 'ghl_contact_id'],
    limit: 500,
  });

  // How much live work each contractor has. Sorting by it puts the accounts
  // worth opening at the top, which is the only question anyone asks of this
  // menu: which of these has something to look at?
  const proposals = await client.select<{ contractor_id: string | null }>({
    from: 'proposals',
    columns: ['contractor_id'],
    filters: { status: 'in.(submitted,accepted)' },
    limit: 500,
  });
  const workByContractor = new Map<string, number>();
  for (const p of proposals) {
    const id = p.contractor_id;
    if (id === null || id === '00000000-0000-0000-0000-000000000000') continue;
    workByContractor.set(id, (workByContractor.get(id) ?? 0) + 1);
  }

  const byId = new Map(contractors.map((c) => [c.id, c]));
  const byGhl = new Map<string, ContractorRow[]>();
  const byEmail = new Map<string, ContractorRow[]>();
  for (const c of contractors) {
    if (c.ghl_contact_id) byGhl.set(c.ghl_contact_id, (byGhl.get(c.ghl_contact_id) ?? []).concat(c));
    if (c.email) {
      const key = c.email.toLowerCase();
      byEmail.set(key, (byEmail.get(key) ?? []).concat(c));
    }
  }

  const accounts: DevAccount[] = [];
  for (const profile of profiles) {
    // Same order, and the same refusal to guess on ambiguity, as the real
    // resolver. A list that resolved more generously than production would
    // hide the very failures this switch exists to reproduce.
    let contractor: ContractorRow | null = null;
    if (profile.contractor_id) contractor = byId.get(profile.contractor_id) ?? null;
    if (contractor === null && profile.contact_id) {
      const hits = byGhl.get(profile.contact_id) ?? [];
      if (hits.length === 1) contractor = hits[0]!;
    }
    if (contractor === null && profile.email) {
      const hits = byEmail.get(profile.email.toLowerCase()) ?? [];
      if (hits.length === 1) contractor = hits[0]!;
    }

    accounts.push({
      authProfileId: profile.id,
      email: profile.email ?? '(no email)',
      locationId: profile.location_id ?? '',
      contractorId: contractor?.id ?? null,
      businessName: contractor?.business_name ?? contractor?.full_name ?? '',
      linked: contractor !== null,
      userType: profile.user_type ?? 'unknown',
      liveWork: contractor === null ? 0 : (workByContractor.get(contractor.id) ?? 0),
    });
  }

  // Accounts with actual work first, then linked ones, then the rest. Only
  // three contractors in the whole database have live proposals, so without
  // this the useful ones are buried alphabetically among sixty that are empty.
  return accounts.sort((a, b) => {
    if (a.liveWork !== b.liveWork) return b.liveWork - a.liveWork;
    if (a.linked !== b.linked) return a.linked ? -1 : 1;
    return (a.businessName || a.email).localeCompare(b.businessName || b.email);
  });
}

/** Look one up by id, so the action never trusts what the form posted. */
export async function findDevAccount(authProfileId: string): Promise<DevAccount | null> {
  const accounts = await listDevAccounts();
  return accounts.find((a) => a.authProfileId === authProfileId) ?? null;
}
