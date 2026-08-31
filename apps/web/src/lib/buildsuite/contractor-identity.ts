import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';

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

export class ContractorResolver {
  private readonly client: BuildSuiteClient;

  constructor(client: BuildSuiteClient) {
    this.client = client;
  }

  async resolve(scope: TenantScope): Promise<IdentityResult> {
    const safe = assertScope(scope, 'contractor identity');

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

/** Test seam. */
export function resetContractorResolver(): void {
  cached = null;
}
