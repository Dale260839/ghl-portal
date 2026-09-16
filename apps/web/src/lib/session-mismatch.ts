import type { Role } from './demo-accounts.ts';

/**
 * Is this browser still signed in as someone this screen belongs to?
 *
 * A browser holds ONE sign-in. A page opened as the contractor stays on screen
 * after the same browser signs in as a crew member or homeowner — in another
 * tab, through an invitation or password-reset link, or by going Back to a
 * cached page. Its buttons then post with the new sign-in, and every server
 * action rightly refuses.
 *
 * On 2026-09-17 that refusal reached the error page as "the Hub database refused
 * the write and the team needs to look at it", and was debugged as a database
 * fault. It was `only a contractor can manage the team`: the People page was
 * the contractor's, the cookie was field crew's. The error page asks this first
 * now, and says what actually happened.
 *
 * Pure, and imports only a TYPE from `demo-accounts.ts`: the error page is a
 * client component, and the demo identities must never reach the browser.
 */

export type SessionCheck =
  | { readonly kind: 'match' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'other-role'; readonly role: Role };

export function checkSessionForArea(allowed: readonly Role[], current: Role | null): SessionCheck {
  if (current === null) return { kind: 'signed-out' };
  return allowed.includes(current) ? { kind: 'match' } : { kind: 'other-role', role: current };
}

/** How a role is named to the person reading the error page. */
export const ROLE_PHRASE: Record<Role, string> = {
  contractor: 'the contractor',
  field: 'a field crew member',
  client: 'a homeowner',
};

/**
 * Each role's home. The same answers as `homeFor`, repeated here so the client
 * bundle does not import the demo identities — and a test holds the two equal.
 */
export const HOME_FOR_ROLE: Record<Role, string> = {
  contractor: '/dashboard',
  field: '/field',
  client: '/portal',
};

export function isRole(value: unknown): value is Role {
  return value === 'contractor' || value === 'field' || value === 'client';
}
