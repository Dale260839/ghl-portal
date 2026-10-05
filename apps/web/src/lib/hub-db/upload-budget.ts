import 'server-only';
import { createHash } from 'node:crypto';
import { assertContractor, type TenantScope } from '../tenancy.ts';
import type { HubConfig } from './client.ts';
import type { Session } from '../demo-accounts.ts';

export const MAX_FILE_BYTES = 3_500_000;
export class UploadBudgetError extends Error {}

export function uploadActor(session: Session): string {
  const who = session.membershipId || session.ghlUserId || session.contactId || session.email.trim().toLowerCase();
  if (!who) throw new UploadBudgetError('Your identity could not be verified. Sign in again.');
  return createHash('sha256').update(who).digest('hex');
}

/** Reserve attempts and bytes atomically before storage accepts any bytes. */
export async function consumeUploadBudget(
  config: HubConfig, scope: TenantScope, actorId: string, bytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const contractorId = assertContractor(scope, 'upload budget');
  if (!actorId || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_FILE_BYTES) {
    throw new UploadBudgetError('Send a file no larger than 3.5 MB.');
  }
  const response = await fetchImpl(config.url + '/rest/v1/rpc/hub_claim_upload', {
    method: 'POST',
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_contractor_id: contractorId, p_actor_key: actorId, p_bytes: bytes }),
  });
  if (!response.ok) throw new UploadBudgetError('Upload limits are unavailable. Ask your contractor to check the storage setup.');
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || !('allowed' in value) || value.allowed !== true) {
    throw new UploadBudgetError('The upload allowance has been reached. Try later or contact your contractor.');
  }
}
