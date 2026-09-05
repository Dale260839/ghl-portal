import { beginClientVerification } from './client-lookup.ts';
import { createRateLimiter, signInRequestKeys, SIGN_IN_REQUEST_LIMIT } from './rate-limit.ts';
import type { RateLimiter } from './rate-limit.ts';
import type { EmailMessage, EmailSender } from '../email/sender.ts';
import type { Contact } from '../data/types.ts';

/**
 * The client sign-in front door: email + project code in, a link out.
 *
 * This is the step C-2 describes and the one the Hub has been missing. The two
 * halves either side of it already existed — `client-lookup.ts` locates without
 * minting, `verification-token.ts` mints the single-use credential — and this
 * joins them to delivery and to the attempt limit.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS FILE EXISTS TO KEEP
 *
 * **The caller learns nothing about who exists.** A real homeowner with the
 * right code, a real homeowner with someone else's code, and a stranger
 * guessing both get the same `sent` outcome, in the same shape. Not because the
 * lookup is weak, but because the response is the only channel an enumerator
 * has, and it has to stay silent.
 *
 * That extends to failure. If delivery breaks, the caller still gets `sent`.
 * Reporting a send failure would answer "does this account exist?" precisely,
 * since nothing is sent for an account that does not. The failure goes to the
 * server log instead, where the operator can see it and the visitor cannot.
 *
 * The one thing the caller IS told is `rate_limited`, and that is deliberate.
 * It reveals only that this caller has been hammering, which they already know,
 * and it is independent of whether any account matched. Withholding it would
 * leave a real homeowner staring at a form that silently stopped working.
 * ---------------------------------------------------------------------------
 */

export type SignInRequestOutcome =
  /** Indistinguishable success. Says nothing about whether anything matched. */
  | { readonly result: 'sent' }
  /** This caller is over the limit. Independent of account existence. */
  | { readonly result: 'rate_limited'; readonly retryAfterSeconds: number };

/** What the caller must supply. Injected so the whole path is testable. */
export interface SignInRequestDeps {
  readonly sender: EmailSender;
  readonly secret: string;
  /** Absolute origin, e.g. `https://hub.example.com`. No trailing slash. */
  readonly origin: string;
  readonly limiter: RateLimiter;
  /**
   * Caller IP, so one enumerator cannot walk many emails from one machine.
   * Empty is tolerated: the email key still applies, so the counter that stops
   * the code walk is never absent (see `signInRequestKeys`).
   */
  readonly ip?: string;
  readonly contacts?: readonly Contact[];
  readonly now?: number;
  readonly jti?: string;
}

/** One limiter for the process, matching how `/auth/verify` holds its own. */
export const signInLimiter: RateLimiter = createRateLimiter(SIGN_IN_REQUEST_LIMIT);

/** The link a homeowner clicks. `/auth/verify` consumes it exactly once. */
export function signInLinkFor(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/verify?token=${encodeURIComponent(token)}`;
}

/**
 * The message itself.
 *
 * Written for someone who has never heard of a magic link: it says what the
 * link does, that it expires, and what to do if they did not ask for it. No
 * project code is echoed back, because an email is forwardable and the code is
 * one of the two things needed to request another link.
 */
export function signInEmail(to: string, link: string): EmailMessage {
  const text = [
    'Here is your sign-in link for your Project Hub.',
    '',
    link,
    '',
    'The link works once and expires in 15 minutes. If it has expired, request a new one.',
    '',
    'If you did not ask to sign in, you can ignore this email. Nothing has changed on your project.',
  ].join('\n');

  return { to, subject: 'Your Project Hub sign-in link', text };
}

/**
 * Locate, mint, deliver — and reveal nothing.
 *
 * Order matters. The limit is consumed BEFORE the lookup, so an enumerator
 * cannot use a miss to avoid being counted; every attempt costs the same.
 */
export async function requestSignInLink(
  email: string,
  projectCode: string,
  deps: SignInRequestDeps,
): Promise<SignInRequestOutcome> {
  const decision = deps.limiter.consume(signInRequestKeys(email, deps.ip ?? ''), { now: deps.now });
  if (!decision.allowed) {
    return { result: 'rate_limited', retryAfterSeconds: decision.retryAfterSeconds };
  }

  const begun = beginClientVerification(email, projectCode, deps.secret, {
    contacts: deps.contacts,
    now: deps.now,
    jti: deps.jti,
  });

  // Nothing matched. Same outcome, same shape, no send.
  if (!begun.located || begun.token === undefined) {
    return { result: 'sent' };
  }

  const outcome = await deps.sender.send(
    signInEmail(email.trim().toLowerCase(), signInLinkFor(deps.origin, begun.token)),
  );

  if (!outcome.delivered) {
    // Visible to the operator, invisible to the visitor. The reason never
    // contains the message, so the token cannot reach the log through it.
    console.error(`[auth] sign-in link could not be delivered: ${outcome.reason}`);
  }

  return { result: 'sent' };
}

/**
 * What the page shows, for every outcome.
 *
 * Kept here rather than in the component so the wording cannot drift apart from
 * the guarantee above. The `sent` copy is careful: "if that matches an account"
 * is doing real work, it is what stops the sentence confirming anything.
 */
export function signInRequestMessage(outcome: SignInRequestOutcome): string {
  if (outcome.result === 'rate_limited') {
    const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
    return `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  }
  return 'If that matches a project, we have emailed a sign-in link. It works once and expires in 15 minutes.';
}
