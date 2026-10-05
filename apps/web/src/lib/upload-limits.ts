import 'server-only';

import { createRateLimiter, type RateLimiter } from './auth/rate-limit.ts';

/**
 * Cheap-write loop protection, per instance. Callers use a stable user key.
 * Upload bytes and attempts are instead bounded atomically in the database
 * by hub-db/upload-budget.ts; this in-memory limiter is not a storage quota.
 */
/**
 * Writes that are cheap but not free — issues, comments, messages.
 *
 * Generous on purpose. The point is to stop a loop, not to ration a
 * conversation with a contractor.
 */
export const CLIENT_WRITE_LIMIT = { limit: 120, windowSeconds: 60 * 60 } as const;

const writes: RateLimiter = createRateLimiter(CLIENT_WRITE_LIMIT);

/**
 * Keyed on the person, not the project.
 *
 * A crew member on four jobs is one person with one phone and one bill; a key
 * per project would multiply their allowance by the number of projects they
 * happen to be on, which is exactly backwards.
 */
function keyFor(prefix: string, who: string): string[] {
  const person = who.trim().toLowerCase();
  return [`${prefix}:${person === '' ? 'anonymous' : person}`];
}

export interface LimitDecision {
  allowed: boolean;
  /** Ready to show. Names minutes, because seconds are not how people wait. */
  message: string;
}

function decide(limiter: RateLimiter, keys: string[], what: string): LimitDecision {
  const decision = limiter.consume(keys);
  if (decision.allowed) return { allowed: true, message: '' };

  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  return {
    allowed: false,
    message: `That is a lot of ${what} at once. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
  };
}

export function allowClientWrite(who: string): LimitDecision {
  return decide(writes, keyFor('write', who), 'messages');
}
