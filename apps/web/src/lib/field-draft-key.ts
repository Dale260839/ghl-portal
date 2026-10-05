import { createHash } from 'node:crypto';
import type { Session } from './demo-accounts.ts';
import type { TenantScope } from './tenancy.ts';

/** No raw email or tenant identifiers in the browser's draft key. */
export function fieldDraftKey(session: Session, scope: TenantScope): string | null {
  const person = session.membershipId || session.email.trim().toLowerCase();
  if (!person) return null;
  const identity = JSON.stringify([scope.contractorId, [...scope.authProfileIds].sort(), person]);
  return 'bs_field_draft:v2:' + createHash('sha256').update(identity).digest('hex');
}
