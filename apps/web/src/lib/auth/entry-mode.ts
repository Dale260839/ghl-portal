/**
 * Which door the sign-in page is standing in, decided before anything is sent.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SUB-ACCOUNT IS OPTIONAL IN ONE DOOR AND REQUIRED IN THE OTHER
 *
 * **Embedded** — a Marketplace Custom Page rendered inside GoHighLevel. GHL does
 * not substitute merge fields into a Custom Page URL, so there is no
 * `locationId` in the query string and there never will be. It arrives in the
 * encrypted user context instead, as `activeLocation`.
 *
 * That is the copy worth trusting. A query parameter is a *claim* — anybody can
 * type one — whereas the payload is decrypted with a secret only this server
 * holds. Demanding the claim before we would even ask for the proof refused
 * every real Custom Page sign-in, which is how this was found: a contractor
 * opening Project Hub from the GHL sidebar, 5 October 2026.
 *
 * **Direct** — a signed link, or a menu link opened in its own tab. There is no
 * parent frame to ask, so the sub-account has to come from the URL or the page
 * has nothing at all to go on.
 *
 * When the embedded door DOES carry a sub-account it is kept and sent, because
 * the server cross-checks it against the decrypted `activeLocation` and refuses
 * a mismatch. Dropping it here would quietly discard that check.
 * ---------------------------------------------------------------------------
 */

export type Entry =
  /** Ask the parent frame for user context. `locationId` is a cross-check, not a source. */
  | { kind: 'embedded'; locationId: string | null }
  /** Everything the server needs is already in the URL. */
  | { kind: 'direct'; locationId: string }
  /** Misconfigured in a way no request would diagnose. Say so instead of asking. */
  | { kind: 'blocked'; message: string; hint?: string };

export interface EntryInput {
  /** Straight from the query string; may be absent, blank or uninterpolated. */
  locationId: string;
  /** A signed landing proves itself in the URL and needs no parent frame. */
  hasSignature: boolean;
  /** `window.parent !== window` at the call site. */
  insideFrame: boolean;
}

/**
 * A merge field GoHighLevel never substituted.
 *
 * Saving the link as `?locationId={{location.id}}` where GHL does not
 * interpolate delivers the literal braces. Down the normal path that surfaces
 * as "this sub-account doesn't exist", which sends someone hunting a
 * permissions problem that was never there.
 *
 * Refused in BOTH doors, deliberately. The embedded door could ignore it and
 * still sign the person in from the payload — and that is exactly the reason
 * not to. A link that silently works despite being wrong stays wrong.
 */
function looksUnsubstituted(value: string): boolean {
  return value.includes('{{') || value.includes('}}');
}

export function readEntry(input: EntryInput): Entry {
  const locationId = input.locationId.trim();

  if (locationId !== '' && looksUnsubstituted(locationId)) {
    return {
      kind: 'blocked',
      message: 'GoHighLevel did not fill in the sub-account.',
      hint:
        `The link arrived with "${locationId}" instead of a real ID, so the merge field wasn't ` +
        'substituted. A Marketplace Custom Page cannot substitute one at all — remove it from ' +
        "the URL, or put the sub-account's ID in directly.",
    };
  }

  // A signature is proof on its own, so it wins even inside a frame: there is
  // no reason to go asking a parent for context we already hold.
  if (input.insideFrame && !input.hasSignature) {
    return { kind: 'embedded', locationId: locationId === '' ? null : locationId };
  }

  if (locationId === '') {
    return {
      kind: 'blocked',
      message: 'This link is missing its sub-account.',
      hint: 'A Custom Menu Link opened in its own tab needs a locationId on the end of the URL.',
    };
  }

  return { kind: 'direct', locationId };
}
