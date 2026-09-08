import 'server-only';

/**
 * Sending mail, behind one interface.
 *
 * The Hub sends exactly one kind of email today, the client sign-in link, and
 * that link IS the credential (`verification-token.ts`). So this file has one
 * job and one rule: the token appears in the message body and nowhere else.
 * Not in a log line, not in an error, not in a return value that something
 * upstream might render. Everything below is arranged around that.
 *
 * The provider is Resend, chosen for the pilot, and it is reached over plain
 * `fetch` rather than an SDK so there is no dependency to keep current for
 * three lines of HTTP. Swapping providers means writing another `EmailSender`
 * and changing `resolveEmailSender`; no caller moves.
 */

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Always present, because some clients never render HTML. */
  readonly text: string;
  readonly html?: string;
}

export type EmailResult =
  | { readonly delivered: true; readonly id: string }
  | { readonly delivered: false; readonly reason: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailResult>;
}

/** Where sign-in links appear to come from. */
export const DEFAULT_FROM = 'Project Hub <noreply@alliance4contractors.com>';

/**
 * Resend over `fetch`.
 *
 * A failed send returns `delivered: false` rather than throwing. The caller is
 * a sign-in request that must answer identically whether or not an account
 * exists, so it cannot afford to crash on one branch and succeed on the other:
 * the difference in response would itself be the leak.
 */
export function createResendSender(apiKey: string, from: string = DEFAULT_FROM): EmailSender {
  return {
    async send(message) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.html === undefined ? {} : { html: message.html }),
          }),
        });

        if (!response.ok) {
          // The body can echo the payload, so it is summarized, never included.
          return { delivered: false, reason: `resend responded ${response.status}` };
        }

        const body = (await response.json()) as { id?: unknown };
        return {
          delivered: true,
          id: typeof body.id === 'string' ? body.id : 'unknown',
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown transport error';
        return { delivered: false, reason };
      }
    },
  };
}

/**
 * The local sender: prints the link so a developer can click it.
 *
 * Deliberately refuses to exist outside development. If this ran in production
 * it would write live sign-in credentials into a log aggregator, which is worse
 * than not sending the mail at all — a missing email is a visible failure, a
 * leaked credential is an invisible one.
 */
export function createConsoleSender(): EmailSender {
  return {
    async send(message) {
      if (process.env.NODE_ENV === 'production') {
        return { delivered: false, reason: 'console sender refuses to run in production' };
      }
      console.log(`\n[email:dev] to ${message.to}\n[email:dev] ${message.subject}\n${message.text}\n`);
      return { delivered: true, id: 'console' };
    },
  };
}

/**
 * A sender that always fails, for production with no provider configured.
 *
 * The alternative would be falling back to the console sender, which is how a
 * sign-in link ends up in a production log. Failing loudly and sending nothing
 * is the safe direction: the request still answers normally to the caller, and
 * the server logs that delivery is unconfigured without quoting the message.
 */
export function createUnconfiguredSender(): EmailSender {
  return {
    async send() {
      return { delivered: false, reason: 'no email provider configured (RESEND_API_KEY unset)' };
    },
  };
}

/**
 * Pick a sender from the environment.
 *
 * With a key, Resend. Without one in development, the console so the flow is
 * testable end to end. Without one in production, a sender that fails rather
 * than one that logs credentials.
 */
export function resolveEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (apiKey !== '') return createResendSender(apiKey, env.EMAIL_FROM?.trim() || DEFAULT_FROM);
  if (env.NODE_ENV === 'production') return createUnconfiguredSender();
  return createConsoleSender();
}
