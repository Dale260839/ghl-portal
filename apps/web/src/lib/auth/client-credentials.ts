import { createRateLimiter, clientCodeKeys, CLIENT_CODE_LIMIT } from './rate-limit.ts';
import type { RateLimiter } from './rate-limit.ts';

/**
 * The homeowner's front door: their email, and their project code as password.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY THE FILE NEXT DOOR NOW HAS A CAVEAT ON IT
 *
 * Chris, 2026-09-10: when the contractor and the homeowner sign, a BuildSuite
 * automation sends the homeowner their project code. That code IS their
 * password; the email on the contract is their username. Nobody invites them,
 * nothing expires between signature and first visit, and the whole path is
 * automatic on both sides.
 *
 * `client-lookup.ts` is the older door — email plus code as a LOOKUP that mints
 * only an emailed token — and it carries this sentence, which was written
 * before this decision and is worth repeating rather than deleting:
 *
 *     "The code space is small … That is acceptable ONLY because this mints
 *      nothing … If this ever issues a session directly, the code is not enough."
 *
 * This file is that "ever". The concern was raised and the decision stands, so
 * what is left is to make the weak factor as expensive as it can be made:
 *
 *   1. **The signature gate.** `findSignedProjectForClient` requires a SIGNED
 *      proposal on the project. An unsigned project's code opens nothing, at
 *      any rate, forever. This is the largest single reduction available and it
 *      is the rule as stated — "all the signed project should have that".
 *   2. **Both halves matched inside the database**, and `client_email` is never
 *      selected, so the address is compared without being handed back.
 *   3. **Five attempts an hour**, keyed on the email and the caller's IP and
 *      never on the code. See `CLIENT_CODE_LIMIT` for the arithmetic.
 *   4. **No stored hash.** The code is checked live against BuildSuite every
 *      time, so `hub_memberships` holds no client credential to crack, and a
 *      contract that stops being signed stops opening a portal.
 *
 * Residual risk, stated plainly rather than buried: an attacker who knows a
 * homeowner's email address and is willing to guess for hours can find a
 * six-bit sequential code. Raising the code's entropy is a BuildSuite-side
 * change and is the real fix; it is logged in the handoff.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not touch cookies, headers or `next/navigation`. It takes its
 * dependencies as arguments and returns an outcome, so the whole policy is
 * testable without a database, a request or a session — the same shape as
 * `sign-in-request.ts`, for the same reason.
 * ---------------------------------------------------------------------------
 */

/** What the code door needs about a project. Mirrors the BuildSuite reader. */
export interface SignedProjectForClient {
  projectId: string;
  contractorId: string;
  ghlContactId: string;
  clientName: string;
}

/** The one reader method this needs. Narrow, so a test needs no database. */
export interface SignedProjectReader {
  findSignedProjectForClient(
    projectCode: string,
    clientEmail: string,
  ): Promise<SignedProjectForClient | null>;
}

/** The membership fields the caller turns into a session. */
export interface ProvisionedClient {
  id: string;
  email: string;
  fullName: string;
  role: string;
  projectIds: string[];
}

/** The one store method this needs. `HubTeam` satisfies it. */
export interface ClientAccountStore {
  provisionClientFromSignedProject(input: {
    contractorId: string;
    email: string;
    projectId: string;
    clientName: string;
  }): Promise<{ ok: true; membership: ProvisionedClient } | { ok: false; reason: 'revoked' }>;
}

export type ClientCodeOutcome =
  /** Proven, and the account is open. The caller mints the session. */
  | { readonly result: 'signed-in'; readonly membership: ProvisionedClient }
  /**
   * ONE failure for every way it can fail: wrong code, wrong email, unsigned
   * contract, no such project. The caller sees the same thing whichever, so the
   * response cannot be used to sort real addresses and codes from invented
   * ones, or to discover which projects have been signed.
   */
  | { readonly result: 'rejected' }
  /**
   * Distinguished on purpose. The contractor withdrew this homeowner's access,
   * and the caller has already proved the code and the email — so they own the
   * account, and telling them beats leaving them retyping a code that is right.
   */
  | { readonly result: 'revoked' }
  /** Over the limit. Independent of whether anything matched. */
  | { readonly result: 'rate_limited'; readonly retryAfterSeconds: number }
  /**
   * A database is down. NOT folded into `rejected`: a homeowner deserves to be
   * told the difference between "that is wrong" and "come back in a minute",
   * and this outcome reveals nothing about any account.
   */
  | { readonly result: 'unavailable' };

export interface ClientCodeDeps {
  readonly reader: SignedProjectReader;
  readonly store: ClientAccountStore;
  readonly limiter: RateLimiter;
  /** Caller IP. Empty is tolerated — the email key still applies. */
  readonly ip?: string;
  readonly now?: number;
}

/** One limiter for the process, matching how the other two doors hold theirs. */
export const clientCodeLimiter: RateLimiter = createRateLimiter(CLIENT_CODE_LIMIT);

/**
 * Verify email + project code, and open the account it proves.
 *
 * The order is not arbitrary. The limit is spent BEFORE the lookup, so a
 * refused caller costs no database read and cannot use timing to tell a real
 * address from an invented one. The lookup then proves everything, and only
 * then does anything get written.
 */
export async function signInWithProjectCode(
  email: string,
  projectCode: string,
  deps: ClientCodeDeps,
): Promise<ClientCodeOutcome> {
  const decision = deps.limiter.consume(clientCodeKeys(email, deps.ip ?? ''), { now: deps.now });
  if (!decision.allowed) {
    return { result: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  let found: SignedProjectForClient | null;
  try {
    found = await deps.reader.findSignedProjectForClient(projectCode, email);
  } catch {
    // A read that threw is not a rejection. Reporting it as one would tell a
    // homeowner their own code is wrong during an outage, and they would go
    // and ask their contractor for a code that was right all along.
    return { result: 'unavailable' };
  }

  if (found === null) return { result: 'rejected' };

  // Proven, but not yet usable. Everything downstream — the portal's project
  // list, the §9.1 gate, revocation — hangs off a membership, so an account
  // that cannot be opened is a sign-in that cannot be honoured.
  let opened: Awaited<ReturnType<ClientAccountStore['provisionClientFromSignedProject']>>;
  try {
    opened = await deps.store.provisionClientFromSignedProject({
      contractorId: found.contractorId,
      email,
      projectId: found.projectId,
      clientName: found.clientName,
    });
  } catch {
    return { result: 'unavailable' };
  }

  if (!opened.ok) return { result: 'revoked' };

  // Only a real sign-in clears the counter. Clearing it on a rejection would
  // mean an attacker's wrong guesses refunded their own budget; clearing it
  // here just stops a homeowner who fumbled the code twice from being locked
  // out of their next visit an hour later.
  for (const key of clientCodeKeys(email, deps.ip ?? '')) deps.limiter.reset(key);

  return { result: 'signed-in', membership: opened.membership };
}

/**
 * What the screen says. One sentence per outcome, and the two that matter are
 * deliberately vague about which half was wrong.
 */
export function clientCodeMessage(outcome: ClientCodeOutcome): string {
  switch (outcome.result) {
    case 'signed-in':
      return '';
    case 'rejected':
      return 'We could not sign you in. Check the email address and the project code your contractor sent you when your contract was signed.';
    case 'revoked':
      return 'This account no longer has access to the project. Ask your contractor to restore it.';
    case 'rate_limited': {
      const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
      return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    case 'unavailable':
      return 'We could not check your details just now. Please try again in a moment.';
  }
}
