import { issueVerificationToken } from './verification-token.ts';

/**
 * Email + project CODE as a LOOKUP only (C-2, D3 §6).
 *
 * This proves a record exists and mints NOTHING. Possession of an email and a
 * code must get you nowhere on its own — the credential is the emailed token
 * (`verification-token.ts`), issued only after this locates a match, and it is
 * sent to the address already on that record.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT IS NOT COSMETIC (2026-09-03)
 *
 * It used to match `contact.projectIds` — BuildSuite's internal UUID — against
 * fixture contacts. Two things were wrong with that. Chris's decision is that
 * the homeowner is handed the **project code** (`BSA-NNN`) by their contractor,
 * which is a different column; and a UUID is not something anyone reads down a
 * phone, so in practice the second factor would have been unusable and the
 * pressure would have been to drop it.
 *
 * THE MATCH ITSELF LIVES IN ONE PLACE: `reader.findProjectForClientLogin`,
 * which compares both halves inside the database and never selects
 * `client_email`. There is deliberately no second copy of the rule here to
 * drift away from it.
 *
 * The code space is small — `BSA-NNN` is three digits. That is acceptable ONLY
 * because this mints nothing: guessing a code gets an attacker an email sent to
 * somebody else's address. **If this ever issues a session directly, the code is
 * not enough.**
 * ---------------------------------------------------------------------------
 */

/** The one reader method this needs. Narrow, so a test needs no database. */
export interface ClientLoginReader {
  findProjectForClientLogin(
    projectCode: string,
    clientEmail: string,
  ): Promise<{ id: string; ghlContactId: string } | null>;
}

export interface BeginVerificationResult {
  located: boolean;
  /** Present only when located — the token to email. Delivery is a later wire. */
  token?: string;
}

/**
 * The request step: locate, then issue a token for the located contact.
 *
 * The caller must respond identically whether or not a match was found — "if
 * that matches an account, we've sent a link" — so the response never reveals
 * which emails or codes exist. This returns a single `located` boolean for that
 * reason: it leaks nothing about which half missed.
 */
export async function beginClientVerification(
  email: string,
  projectCode: string,
  secret: string,
  reader: ClientLoginReader,
  options: { now?: number; jti?: string } = {},
): Promise<BeginVerificationResult> {
  const found = await reader.findProjectForClientLogin(projectCode, email);
  if (found === null) return { located: false };

  // A project whose GoHighLevel contact id is blank cannot receive anything
  // addressed to a contact. Locating it and then issuing a token against an
  // empty id would mint a credential nobody can be identified by — and the
  // portal resolves a client BY that id.
  if (found.ghlContactId.trim() === '') return { located: false };

  const token = issueVerificationToken(
    { contactId: found.ghlContactId, email: email.trim().toLowerCase() },
    secret,
    { now: options.now, jti: options.jti },
  );
  return { located: true, token };
}
