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
