/**
 * Tenancy — whose data a request is allowed to touch.
 *
 * **The tenant is the GHL sub-account, not a person.** That's how BuildSuite
 * works, and matching it matters: its Custom Menu Link passes only
 * `locationId`, and everything a contractor sees is scoped to that location.
 *
 * A location maps to *several* BuildSuite `auth_profiles` — the live agency
 * `IifYfP2B2NUaoDPdsTTa` has two admin profiles owning nine projects between
 * them. Scoping to one profile would hide half an agency's work from itself, so
 * a scope carries the whole set.
 *
 * §9.1 already scopes *client* reads to the signed-in contact's projects. This
 * is the equivalent rule one level up, and it's enforced the same way: at the
 * data layer, structurally. Read functions take a `TenantScope` as a required
 * argument, so forgetting to scope is a type error rather than a leak.
 *
 * Without it, one read returns everything: 43 active projects across 5
 * contractors, measured on the live database.
 */

export interface TenantScope {
  /** The GHL sub-account. The tenant identity itself. */
  locationId: string;
  /**
   * Every BuildSuite `auth_profiles.id` belonging to that location. Verified as
   * the owning column on `projects`; `user_id` and `client_id` are unpopulated.
   */
  authProfileIds: readonly string[];
  /**
   * `contractors.id` — a DIFFERENT id from any of the above, and the key the
   * Hub's own tables and `proposals` are filed under.
   *
   * Resolved once per request by `requireTenantScope`, because deriving it is
   * two BuildSuite reads and every screen would otherwise repeat them.
   *
   * **It is not interchangeable with an auth profile id**, and treating it as
   * one was a real bug on 2026-09-01: Hub records were written with
   * `contractor_id = authProfileIds[0]`, so a contractor's own records became
   * invisible to them the moment the value was resolved properly. For Ralph the
   * two differ — auth profile `7726102a…`, contractor `5dd312bd…`.
   *
   * Absent when the session could not be linked to a contractor. Hub reads and
   * writes must then do nothing, never fall back to another id.
   */
  contractorId?: string;
}

export class TenancyError extends Error {
  constructor(context: string) {
    super(`refusing an unscoped read of ${context} — every read must be scoped to one tenant`);
    this.name = 'TenancyError';
  }
}

/**
 * Fails closed. An absent scope, a blank location, or an empty profile list all
 * raise — because the natural fallback for a missing tenant filter is the entire
 * database, and an empty `in ()` clause is the same mistake wearing a disguise.
 */
export function assertScope(scope: TenantScope | null | undefined, context: string): TenantScope {
  if (scope === null || scope === undefined) throw new TenancyError(context);
  if (typeof scope.locationId !== 'string' || scope.locationId.trim() === '') {
    throw new TenancyError(context);
  }
  if (!Array.isArray(scope.authProfileIds) || scope.authProfileIds.length === 0) {
    throw new TenancyError(context);
  }
  if (scope.authProfileIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    throw new TenancyError(context);
  }
  return scope;
}

/** True when a row's owner belongs to this tenant. */
export function ownedByScope(scope: TenantScope, ownerAuthProfileId: string): boolean {
  return scope.authProfileIds.includes(ownerAuthProfileId);
}

/**
 * The contractor a Hub read or write is filed under.
 *
 * Separate from `assertScope` because they answer different questions and a
 * caller can legitimately have one without the other: a contractor signed in
 * through GoHighLevel always has a scope, and only has a `contractorId` once
 * their profile resolves to a contractor record.
 *
 * Throws rather than returning a default. The default would be an auth profile
 * id, which is exactly the bug this exists to prevent.
 */
export function assertContractor(scope: TenantScope | null | undefined, context: string): string {
  const safe = assertScope(scope, context);
  const id = safe.contractorId;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TenancyError(
      `${context}: this session is not linked to a contractor record, so there is nothing to file under`,
    );
  }
  return id;
}
