import type { Session } from './session.ts';
import { realIdentity } from './view-as.ts';

/**
 * Who may switch accounts and assume another role (Dale, 2026-09-29).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "Switch account" and "Viewing as" are operator tools. They were gated on
 * environment flags alone, which was the right gate when one agency used this
 * and the wrong one the moment 149 sub-accounts came online: every contractor
 * on every one of them saw both controls, because a flag cannot tell one
 * contractor from another.
 *
 * `DISABLE_VIEW_AS` was the worse of the two — it is *off by default*, so the
 * role switcher was on for everybody unless somebody remembered to turn it off.
 *
 * So the gate is now an identity, not a flag: the sub-accounts named in
 * `ADMIN_LOCATION_IDS`. Everyone else does not see the controls, and — this is
 * the half that matters — the server actions behind them refuse. A hidden
 * button is a UI fact; these are POST endpoints anybody can construct.
 *
 * EMPTY MEANS NOBODY. An unset variable does not fall back to "the first
 * location" or "the deployment's own", because a default that guesses who the
 * administrator is will eventually guess wrong in somebody's favour.
 *
 * VIEWING AS DOES NOT REVOKE IT. While an admin is viewing as a crew member
 * their session says `role: 'field'` — but the identity that matters is the one
 * they came from, which `realIdentity` carries. Reading the surface session
 * would strand them in the assumed view with no way back.
 * ---------------------------------------------------------------------------
 */

export function adminLocationIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.ADMIN_LOCATION_IDS ?? '')
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/**
 * Whether this session belongs to an operator account.
 *
 * Keyed on the GoHighLevel sub-account, because that is what the Hub actually
 * knows about a contractor: a session has no user of its own (see
 * AUTHENTICATION-AUDIT.md §2), so "this person is an admin" is not a question
 * this system can answer yet. "This sub-account is the agency's own" is.
 */
export function isAdminSession(
  session: Session | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (session === null) return false;
  // Only staff. A homeowner's session carries no sub-account at all, and a
  // crew member's belongs to their contractor rather than to them.
  const real = realIdentity(session);
  if (real.role !== 'contractor') return false;

  // Deliberately not `?? ''`. A blank location must never flow onward as a
  // value — §3.6's rule, and the guardrail that enforces it is right even here,
  // where the very next line would have refused it.
  const location = real.ghlLocationId;
  if (typeof location !== 'string' || location.trim() === '') return false;
  if (real.ghlIdentityVerified !== true || !real.ghlUserId) return false;
  const allowedUsers = (env.ADMIN_GHL_USER_IDS ?? '').split(/[,\s]+/).filter(Boolean);
  if (allowedUsers.length > 0 ? !allowedUsers.includes(real.ghlUserId) : real.ghlRole !== 'admin') {
    return false;
  }

  return adminLocationIds(env).includes(location.trim());
}
