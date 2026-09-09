import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';
import { createTtlCache } from '../ttl-cache.ts';

/**
 * Which contractor is this session?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT FAILS CLOSED
 *
 * `proposals` carries no `auth_profile_id`. It carries `contractor_id`. So the
 * tenant filter for the book of work is not the project owner — it is the
 * contractor, and a session has to be resolved to one before anything can be
 * shown.
 *
 * **If the contractor cannot be resolved, the answer is NOTHING, not
 * EVERYTHING.** That is the whole point of this file. Without it, a scoped read
 * of `proposals` returns every contractor's live work to any signed-in user,
 * which is precisely the leak found in August: 43 projects across five
 * contractors visible to anyone.
 *
 * THREE LINKS, TRIED IN ORDER. Measured across 65 contractor-ish profiles on
 * 2026-08-31:
 *
 *   1. `auth_profiles.contractor_id` → `contractors.id`      1 of 110
 *   2. `auth_profiles.contact_id` → `contractors.ghl_contact_id`  54
 *   3. `auth_profiles.email` → `contractors.email`          52
 *
 * Together they resolve **58 of 65**. The dedicated column is nearly empty, but
 * the GoHighLevel contact id is not: `contractors.ghl_contact_id` is populated
 * on 472 of 483, because it is written when a contractor is onboarded through
 * GHL — which is how they all arrive.
 *
 * **The three never disagree.** Of the 45 profiles resolvable by both the
 * contact id and the email, all 45 give the same contractor. That is what makes
 * a fallback chain safe rather than a guess: they are corroborating routes to
 * one answer, not competing opinions.
 *
 * Every one is an exact match on an id or a normalized address. None matches on
 * a name or a business name, per §3.6 and D4 §6 — a rename must never silently
 * repoint a cross-system link.
 * ---------------------------------------------------------------------------
 */

export interface ContractorIdentity {
  /** `contractors.id` — the key `proposals.contractor_id` points at. */
  contractorId: string;
  /** Which link found it, so a screen can explain itself. */
  via: 'auth_profile' | 'ghl_contact' | 'email';
}

/**
 * The contractor's own details, as they should appear on an invoice.
 *
 * Chris, 10 Sep: an invoice the contractor opens to send should look like a
 * proper invoice — their logo, their contact details, the client filled in from
 * the proposal. This is the first half of that: who is billing.
 *
 * Every field is nullable and stays null when the `contractors` row is blank.
 * A screen renders what is here and nothing else, so a contractor without a
 * website does not get an empty line where a website should be.
 */
export interface ContractorProfile {
  /** `business_name`, falling back to `full_name`. Null when both are blank. */
  businessName: string | null;
  /** Only a real http(s) URL. A stored file name or a path is not one. */
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  /** Street, city, state and postal code joined, with blank parts dropped. */
  address: string | null;
  email: string | null;
}

export type IdentityResult =
  | { resolved: true; identity: ContractorIdentity }
  | {
      resolved: false;
      /**
       * None of the three links resolved, or one of them was ambiguous. Seven
       * of 65 contractor profiles are in this state — not the user's fault, and
       * fixable by setting `contractor_id` on their profile.
       */
      reason: 'unlinked' | 'unavailable';
    };

interface AuthProfileRow {
  id: string;
  contractor_id: string | null;
  contact_id: string | null;
  email: string | null;
}

/**
 * Never `*`, same rule as every other BuildSuite read: the key grants more than
 * it should, so the select is the narrowest thing that answers the question.
 */
const PROFILE_COLUMNS = [
  'business_name',
  'full_name',
  'business_logo_url',
  'business_logo',
  'phone',
  'website',
  'street_address',
  'city',
  'state',
  'postal_code',
  'email',
] as const;

interface ContractorProfileRow {
  business_name: string | null;
  full_name: string | null;
  business_logo_url: string | null;
  business_logo: string | null;
  phone: string | null;
  website: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  email: string | null;
}

/** Trimmed, or null. An empty string on an invoice is a blank line nobody meant. */
function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * A logo only counts if it is something a browser and GoHighLevel can both
 * fetch. Both logo columns hold a mix of URLs and stored file names on the live
 * data, and a file name rendered as an image is a broken image on an invoice.
 */
function httpUrl(value: string | null | undefined): string | null {
  const text = trimmed(value);
  if (text === null) return null;
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}

function toProfile(row: ContractorProfileRow): ContractorProfile {
  const address = [row.street_address, row.city, row.state, row.postal_code]
    .map((part) => trimmed(part))
    .filter((part): part is string => part !== null)
    .join(', ');

  return {
    businessName: trimmed(row.business_name) ?? trimmed(row.full_name),
    logoUrl: httpUrl(row.business_logo_url) ?? httpUrl(row.business_logo),
    phone: trimmed(row.phone),
    website: trimmed(row.website),
    address: address === '' ? null : address,
    email: trimmed(row.email),
  };
}

export class ContractorResolver {
  private readonly client: BuildSuiteClient;

  /**
   * Held per tenant for ten minutes. Resolving is two or three sequential
   * reads and every contractor navigation needs the answer, so it was the
   * single largest fixed cost of a click — for a mapping that changes when
   * someone edits a profile, not between page loads. Keyed on the sorted
   * profile ids (D-013). An unresolved result is held too: relinking a profile
   * shows up within ten minutes, fine for a one-off fix on the BuildSuite side.
   *
   * Lives on the instance, not the module: production has one resolver, and a
   * test that builds its own gets its own empty store.
   */
  private readonly identityCache = createTtlCache<IdentityResult>(10 * 60_000);
  /** Business name per contractor id, same lifetime and the same reasoning. */
  private readonly nameCache = createTtlCache<string | null>(10 * 60_000);
  /**
   * The full invoice profile per contractor id. Held separately from the name
   * because most screens want only the name and this select is wider.
   */
  private readonly profileCache = createTtlCache<ContractorProfile | null>(10 * 60_000);

  constructor(client: BuildSuiteClient) {
    this.client = client;
  }

  async resolve(scope: TenantScope): Promise<IdentityResult> {
    const safe = assertScope(scope, 'contractor identity');
    const key = [...safe.authProfileIds].sort().join(',');
    return this.identityCache.get(key, () => this.lookup(safe));
  }

  /**
   * The contractor's business name, for the shell's brand code and context bar
   * (Chris, 8 Sep: "the code and then Project Hub"). Read through the identity
   * above, so it can only ever be this tenant's own `contractors` row. Null when
   * the session is not linked to a contractor; callers fall back, never guess.
   */
  async businessName(scope: TenantScope): Promise<string | null> {
    const identity = await this.resolve(scope);
    if (!identity.resolved) return null;
    const id = identity.identity.contractorId;

    return this.nameCache.get(id, async () => {
      const rows = await this.client.select<{ business_name: string | null; full_name: string | null }>({
        from: 'contractors',
        columns: ['business_name', 'full_name'],
        filters: { id: `eq.${id}` },
        limit: 1,
      });
      const row = rows[0];
      if (row === undefined) return null;
      const name = (row.business_name ?? row.full_name ?? '').trim();
      return name === '' ? null : name;
    });
  }

  /**
   * The contractor's details for the top of an invoice.
   *
   * Read through the same identity as `businessName`, so it can only ever be
   * this tenant's own `contractors` row, and read-only like everything else
   * that touches BuildSuite. Null when the session is not linked, which the
   * caller renders as "we do not know", never as a blank letterhead.
   */
  async profile(scope: TenantScope): Promise<ContractorProfile | null> {
    const identity = await this.resolve(scope);
    if (!identity.resolved) return null;
    const id = identity.identity.contractorId;

    return this.profileCache.get(id, async () => {
      const rows = await this.client.select<ContractorProfileRow>({
        from: 'contractors',
        columns: PROFILE_COLUMNS,
        filters: { id: `eq.${id}` },
        limit: 1,
      });
      const row = rows[0];
      if (row === undefined) return null;
      return toProfile(row);
    });
  }

  private async lookup(safe: TenantScope): Promise<IdentityResult> {
    const profiles = await this.client.select<AuthProfileRow>({
      from: 'auth_profiles',
      columns: ['id', 'contractor_id', 'contact_id', 'email'],
      filters: { id: `in.(${safe.authProfileIds.join(',')})` },
      limit: 10,
    });

    // 1 · The dedicated field. This is the link the schema intends, and the
    //     only one that cannot be wrong.
    const linked = profiles.find(
      (p) => p.contractor_id !== null && String(p.contractor_id).trim() !== '',
    );
    if (linked !== undefined) {
      return { resolved: true, identity: { contractorId: linked.contractor_id!, via: 'auth_profile' } };
    }

    // 2 · The GoHighLevel contact id. Far better covered than the dedicated
    //     column — `contractors.ghl_contact_id` is set on 472 of 483, because it
    //     is written when a contractor is onboarded through GHL, which is how
    //     they all arrive.
    const contactIds = [...new Set(
      profiles.map((p) => (p.contact_id ?? '').trim()).filter((c) => c !== ''),
    )];
    if (contactIds.length > 0) {
      const byContact = await this.client.select<{ id: string; ghl_contact_id: string | null }>({
        from: 'contractors',
        columns: ['id', 'ghl_contact_id'],
        filters: { ghl_contact_id: `in.(${contactIds.map((c) => `"${c}"`).join(',')})` },
        limit: 5,
      });
      // Seven contact ids in the live data are shared by more than one
      // contractor. Ambiguity resolves to nothing rather than to a coin flip.
      if (byContact.length === 1) {
        return { resolved: true, identity: { contractorId: byContact[0]!.id, via: 'ghl_contact' } };
      }
    }

    // 3 · Email, last. An exact match on a normalized address — never a name,
    //     never a company, because §3.6 and D4 §6 both say a rename must not
    //     silently repoint a link.
    const emails = profiles
      .map((p) => (p.email ?? '').trim().toLowerCase())
      .filter((e) => e !== '');
    if (emails.length === 0) return { resolved: false, reason: 'unlinked' };

    const contractors = await this.client.select<{ id: string; email: string | null }>({
      from: 'contractors',
      columns: ['id', 'email'],
      filters: { email: `in.(${emails.map((e) => `"${e}"`).join(',')})` },
      limit: 5,
    });

    // More than one match means the email is ambiguous, and guessing which
    // contractor someone is would be worse than showing them nothing.
    if (contractors.length !== 1) return { resolved: false, reason: 'unlinked' };

    return { resolved: true, identity: { contractorId: contractors[0]!.id, via: 'email' } };
  }
}

let cached: ContractorResolver | null = null;

export function getContractorResolver(): ContractorResolver | null {
  if (cached !== null) return cached;
  const result = readBuildSuiteConfig();
  if (!result.configured) return null;
  cached = new ContractorResolver(new BuildSuiteClient(result.config));
  return cached;
}

export async function resolveContractor(scope: TenantScope): Promise<IdentityResult> {
  const resolver = getContractorResolver();
  if (resolver === null) return { resolved: false, reason: 'unavailable' };
  return resolver.resolve(scope);
}

/** The signed-in contractor's business name, or null when unlinked or unavailable. */
export async function resolveContractorName(scope: TenantScope): Promise<string | null> {
  const resolver = getContractorResolver();
  if (resolver === null) return null;
  return resolver.businessName(scope);
}

/**
 * The signed-in contractor's details for an invoice, or null when unlinked or
 * unavailable. Callers render what is present and invent nothing.
 */
export async function resolveContractorProfile(
  scope: TenantScope,
): Promise<ContractorProfile | null> {
  const resolver = getContractorResolver();
  if (resolver === null) return null;
  return resolver.profile(scope);
}

/** Test seam. A fresh resolver carries a fresh identity cache. */
export function resetContractorResolver(): void {
  cached = null;
}
