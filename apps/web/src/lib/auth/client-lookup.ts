import { CONTACTS } from '../data/fixtures.ts';
import type { Contact } from '../data/types.ts';
import { issueVerificationToken } from './verification-token.ts';

/**
 * Email + project ID as a LOOKUP only (C-2, D3 §6).
 *
 * This proves a record exists and mints NOTHING. Possession of an email and a
 * project ID must get you nowhere on its own — the credential is the emailed
 * token (`verification-token.ts`), issued only after this locates a match.
 *
 * A match needs both halves: the email belongs to a contact AND that contact is
 * associated with the given project. Either alone returns null, so a real email
 * with someone else's project, or a real project with the wrong email, both
 * fail. Email is matched case- and whitespace-insensitively.
 */
export function locateClient(
  email: string,
  projectId: string,
  contacts: readonly Contact[] = CONTACTS,
): Contact | null {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedProject = projectId.trim();
  if (normalizedEmail === '' || normalizedProject === '') return null;

  const contact = contacts.find((c) => c.email.trim().toLowerCase() === normalizedEmail);
  if (contact === undefined) return null;
  if (!contact.projectIds.includes(normalizedProject)) return null;
  return contact;
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
 * that matches an account, we've sent a link" — so that the response never
 * reveals which emails or projects exist. This function returns a single
 * `located` boolean for that reason; it leaks nothing about which half missed.
 */
export function beginClientVerification(
  email: string,
  projectId: string,
  secret: string,
  options: { contacts?: readonly Contact[]; now?: number; jti?: string } = {},
): BeginVerificationResult {
  const contact = locateClient(email, projectId, options.contacts ?? CONTACTS);
  if (contact === null) return { located: false };

  const token = issueVerificationToken(
    { contactId: contact.id, email: contact.email },
    secret,
    { now: options.now, jti: options.jti },
  );
  return { located: true, token };
}
