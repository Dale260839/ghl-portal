import { normalizeProjectCode, PROJECT_CODE_PATTERN } from '@buildsuite/contracts';

import { clientCodeMessage, type ClientCodeOutcome, type ProvisionedClient } from './client-credentials.ts';
import { passwordSignInKeys, type RateLimiter } from './rate-limit.ts';

/**
 * ONE sign-in for everyone who types credentials (John, 2026-09-15).
 *
 * "Only have one login route; the backend checks whether the request is from a
 * homeowner, a contractor, or the field crew — and the auto log-in from
 * BuildSuite should persist."
 *
 * ---------------------------------------------------------------------------
 * WHO GETS IN HOW
 *
 *   FIELD CREW   email + the password they set from their invitation.
 *   HOMEOWNER    email + their project code (Chris, 2026-09-10), sent by the
 *                BuildSuite automation when the contract is signed.
 *   CONTRACTOR   the BuildSuite / GoHighLevel menu link — `/api/auth/ghl`,
 *                untouched by this file. Contractors hold no Hub password; the
 *                link is verified against GoHighLevel and that is the proof.
 *
 * The person does not say which they are. The shape of what they typed does:
 * a project code (`BSA-053`) goes to the homeowner check, anything else to the
 * password check. Each path keeps its own attempt limit, and the code path's
 * strict one — five an hour, for a six-bit code — is never loosened by the
 * two sharing a form.
 *
 * ---------------------------------------------------------------------------
 * THE DOOR THIS CLOSES
 *
 * The old sign-in page listed demo identities as radio buttons, and picking one
 * — or typing its email — signed you in with NO password, under a REAL
 * BuildSuite profile (Ralph's, 26 live projects). On a public deployment that
 * was anyone, into real client names, addresses and emails. Demo identities
 * now work only when `ENABLE_DEMO_SIGNIN=true`, which nothing sets by default,
 * and never appear on the page otherwise.
 *
 * ---------------------------------------------------------------------------
 * WHAT A FAILURE SAYS
 *
 * One message for every way the credentials can be wrong, so the form cannot
 * be used to learn whose email is on file or whose contract is signed. The
 * messages that DO differ are safe: "too many attempts" (the caller already
 * knows), "try again shortly" (an outage, about no account), and the two a
 * person only sees after proving the password was right.
 * ---------------------------------------------------------------------------
 *
 * Pure: every dependency is passed in, so the whole decision is tested without
 * a database, a request or a cookie.
 */

export const SIGN_IN_FAILED =
  'We could not sign you in. Check your email, and your password or project code.';
const SIGN_IN_UNAVAILABLE = 'We could not check your details just now. Please try again in a moment.';

/** A membership that authenticated with a password. `HubTeam` returns this shape. */
export interface AuthenticatedMember {
  id: string;
  email: string;
  fullName: string;
  role: string;
  authProfileIds: string[];
}

export interface MemberAuthenticator {
  authenticate(
    email: string,
    password: string,
  ): Promise<
    { ok: true; membership: AuthenticatedMember } | { ok: false; reason: 'unknown' | 'revoked' | 'not-activated' }
  >;
}

/** A demo identity — development only. */
export interface DemoIdentity {
  role: string;
  name: string;
  email: string;
  contactId?: string;
  authProfileIds?: readonly string[];
}

export interface UnifiedSignInDeps {
  /** The Hub's password check, or null when the Hub is not connected. */
  readonly member: MemberAuthenticator | null;
  /** The homeowner project-code check (it counts its own attempts). */
  readonly code: (email: string, code: string) => Promise<ClientCodeOutcome>;
  /** The password path's limiter. */
  readonly limiter: RateLimiter;
  readonly ip?: string;
  /** Demo identities, or null — which is what production must pass. */
  readonly demo: ((email: string) => DemoIdentity | undefined) | null;
  readonly now?: number;
}

export type UnifiedSignInOutcome =
  | { readonly result: 'member'; readonly membership: AuthenticatedMember }
  | { readonly result: 'client'; readonly membership: ProvisionedClient }
  | { readonly result: 'demo'; readonly account: DemoIdentity }
  | { readonly result: 'refused'; readonly message: string };

/**
 * Does this look like a project code rather than a password?
 *
 * Judged AFTER the same normalization the homeowner lookup applies, so the
 * router and the door agree: `bsa 53`, `BSA 052` and ` bsa-053 ` are all codes
 * here because they all resolve there. Judging the raw text would send a code
 * typed with a space down the password path, where it can only fail.
 */
export function looksLikeProjectCode(secret: string): boolean {
  return PROJECT_CODE_PATTERN.test(normalizeProjectCode(secret));
}

function memberRefusal(reason: 'revoked' | 'not-activated'): UnifiedSignInOutcome {
  // Safe to say: these are only reached after the password was proven right,
  // so the caller already owns the account being described.
  return {
    result: 'refused',
    message:
      reason === 'revoked'
        ? 'This account no longer has access. Ask your contractor to restore it.'
        : 'Finish setting up your account from your invitation link first.',
  };
}

export async function unifiedSignIn(
  email: string,
  secret: string,
  deps: UnifiedSignInDeps,
): Promise<UnifiedSignInOutcome> {
  const who = email.trim();
  // Passwords are compared exactly as typed; only emptiness is judged here.
  if (who === '' || secret === '') return { result: 'refused', message: SIGN_IN_FAILED };

  // ── A project code: the homeowner check ─────────────────────────────────
  if (looksLikeProjectCode(secret)) {
    const outcome = await deps.code(who, secret);
    if (outcome.result === 'signed-in') return { result: 'client', membership: outcome.membership };
    if (outcome.result !== 'rejected') return { result: 'refused', message: clientCodeMessage(outcome) };

    // Not a homeowner. A field worker's password could happen to be shaped
    // like a code, so it is tried as one — without spending a second attempt,
    // since the code check has already counted this one.
    if (deps.member !== null) {
      const tried = await deps.member.authenticate(who, secret);
      if (tried.ok) return { result: 'member', membership: tried.membership };
      if (tried.reason !== 'unknown') return memberRefusal(tried.reason);
    }
    return { result: 'refused', message: SIGN_IN_FAILED };
  }

  // ── Anything else: the password check ──────────────────────────────────
  const keys = passwordSignInKeys(who, deps.ip ?? '');
  const decision = deps.limiter.consume(keys, { now: deps.now });
  if (!decision.allowed) {
    return { result: 'refused', message: clientCodeMessage({ result: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds }) };
  }

  if (deps.member !== null) {
    const tried = await deps.member.authenticate(who, secret);
    if (tried.ok) {
      for (const key of keys) deps.limiter.reset(key);
      return { result: 'member', membership: tried.membership };
    }
    if (tried.reason !== 'unknown') return memberRefusal(tried.reason);
  }

  // Development only. Production passes `demo: null`, so this never runs there.
  if (deps.demo !== null) {
    const account = deps.demo(who);
    if (account !== undefined) return { result: 'demo', account };
  }

  // The Hub being down is an outage, not a wrong password — a crew member must
  // not be told their correct password is wrong because a database is away.
  if (deps.member === null) return { result: 'refused', message: SIGN_IN_UNAVAILABLE };
  return { result: 'refused', message: SIGN_IN_FAILED };
}
