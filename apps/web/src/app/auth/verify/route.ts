import { NextResponse, type NextRequest } from 'next/server';

import { resolveSessionSecret } from '@/lib/auth/session-crypto';
import { consumeVerificationToken, createMemoryConsumedTokens } from '@/lib/auth/verification-token';
import { CONTACTS } from '@/lib/data/fixtures';
import { homeFor, setSession } from '@/lib/session';

/**
 * Client sign-in landing (§9.2, C-2).
 *
 * The homeowner's path, and the counterpart to the contractor's GHL landing.
 * The emailed link is `https://<domain>/auth/verify?token=<signed token>`. The
 * token is the credential — a single-use, expiring, signed proof (see
 * `verification-token.ts`). Email + project ID only *located* the record and
 * triggered the email; neither reaches this route, and neither would mint a
 * session if it did.
 *
 * On success this mints the SAME signed session cookie the contractor path
 * uses (`setSession`), so every downstream check — approvals, documents,
 * payments — reads the session and never a URL parameter.
 *
 * The Alliance-branded page that collects email + project ID and calls
 * `beginClientVerification` is deliberately not built here — where that front
 * door lives is Chris's to decide (SPRINT §3, Day 4).
 */

export const dynamic = 'force-dynamic';

/**
 * Single-use store, module-level so it holds between requests in one process.
 * PROVISIONAL — see `verification-token.ts`: production keys this on a table so
 * it survives restarts and is shared across serverless instances.
 */
const consumed = createMemoryConsumedTokens();

const FAILURES = {
  expired: 'That sign-in link has expired. Please request a new one.',
  already_used: 'That sign-in link has already been used. Please request a new one.',
  wrong_purpose: 'That link is not a sign-in link.',
  invalid: 'That sign-in link is not valid.',
} as const;

function reject(request: NextRequest, message: string): NextResponse {
  const url = new URL('/', request.nextUrl.origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token') ?? undefined;
  const outcome = consumeVerificationToken(token, resolveSessionSecret(), consumed);

  if (!outcome.valid) {
    console.warn(`[auth] client verification refused: ${outcome.reason}`);
    return reject(request, FAILURES[outcome.reason]);
  }

  const contact = CONTACTS.find((c) => c.id === outcome.contactId);
  if (contact === undefined) {
    // The token is valid but names a contact we can't resolve — refuse rather
    // than mint a session with no identity behind it.
    console.warn(`[auth] client verification: unknown contact ${outcome.contactId}`);
    return reject(request, FAILURES.invalid);
  }

  await setSession({
    role: 'client',
    name: contact.name,
    email: contact.email,
    contactId: contact.id,
  });

  console.log(`[auth] client signed in via verification link — ${contact.id}`);
  return NextResponse.redirect(new URL(homeFor('client'), request.nextUrl.origin));
}
