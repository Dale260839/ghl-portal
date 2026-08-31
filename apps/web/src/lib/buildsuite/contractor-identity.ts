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
 * The link is `auth_profiles.contractor_id`, and it is populated on **1 of 110
 * profiles** (measured 2026-08-31). Email is the fallback and matches 52 of 483
 * contractors. Both are exact-match lookups on an id or a normalized address;
 * neither matches on a name, per §3.6.
 * ---------------------------------------------------------------------------
 */

export interface ContractorIdentity {
  /** `contractors.id` — the key `proposals.contractor_id` points at. */
  contractorId: string;
  /** How it was found, so a screen can say why it saw nothing. */
  via: 'auth_profile' | 'email';
}

export type IdentityResult =
  | { resolved: true; identity: ContractorIdentity }
  | {
      resolved: false;
      /**
       * `unlinked` is by far the common case today and is not the user's fault:
       * their profile has no `contractor_id` and no contractor shares their
       * email. It needs a one-off backfill on BuildSuite's side.
       */
      reason: 'unlinked' | 'unavailable';
    };

interface AuthProfileRow {
  id: string;
  contractor_id: string | null;
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
      columns: ['id', 'contractor_id', 'email'],
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

    // 2 · Email, as a fallback. An exact match on a normalized address — never
    //     a name, never a company, because §3.6 and D4 §6 both say a rename
    //     must not silently repoint a link.
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
