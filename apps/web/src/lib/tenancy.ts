/**
 * Tenancy — which contractor's data a request is allowed to touch.
 *
 * §9.1 already scopes *client* reads to the signed-in contact's projects. This is
 * the equivalent rule one level up: a contractor sees their own projects and
 * nobody else's. Without it, a single BuildSuite database read returns every
 * contractor's work to whoever asked — verified 2026-08-12: 43 active projects
 * across 5 contractors, all visible to any signed-in user.
 *
 * The rule is enforced the same way the gate is — at the data layer, structurally.
 * A read function takes a `TenantScope` as a required argument, so there is no
 * unscoped overload to reach for and forgetting to scope is a type error rather
 * than a leak.
 */

export interface TenantScope {
  /**
   * BuildSuite's `auth_profiles.id` — the login identity that owns projects.
   * Verified as the owning column on `projects`; `user_id` and `client_id` are
   * unpopulated.
   */
  authProfileId: string;
  /** The GHL sub-account. Used to scope GHL reads once that side is connected. */
  ghlLocationId?: string;
}

export class TenancyError extends Error {
  constructor(context: string) {
    super(`refusing an unscoped read of ${context} — every read must be scoped to one contractor`);
    this.name = 'TenancyError';
  }
}

/**
 * Fails closed. An absent or blank scope raises rather than falling back to
 * "everything", because the fallback for a missing tenant filter is the entire
 * database and that is precisely the bug this exists to prevent.
 */
export function assertScope(scope: TenantScope | null | undefined, context: string): TenantScope {
  if (scope === null || scope === undefined) throw new TenancyError(context);
  if (typeof scope.authProfileId !== 'string' || scope.authProfileId.trim() === '') {
    throw new TenancyError(context);
  }
  return scope;
}
