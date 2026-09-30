import 'server-only';

import { createRateLimiter, type RateLimiter } from './auth/rate-limit.ts';

/**
 * How often one person may post a file (Dale, 2026-09-30, from the audit).
 *
 * ---------------------------------------------------------------------------
 * WHY UPLOADS AND NOT EVERYTHING
 *
 * Rate limiting stopped at the three sign-in doors, so every write behind a
 * session was unmetered. Most of those are a nuisance at worst — a homeowner
 * posting forty comments annoys their contractor and costs nothing.
 *
 * Uploads are different, and it is not about abuse: each one is up to 3.5 MB
 * into storage somebody pays for, from a phone, on a tap. The realistic
 * failure is not an attacker — it is a crew member whose signal is poor,
 * tapping Retry twenty times, or a page that loops. **A bill is the damage,
 * and a bill arrives quietly a month later.**
 *
 * WHAT THE NUMBERS MEAN
 *
 * Sixty photographs an hour, per person. A crew member documenting a full day
 * of work uploads perhaps twenty; a homeowner sending pictures of a leak,
 * three or four. Nobody doing their job comes near this, which is the test a
 * limit has to pass — if a real user can feel it, it is the wrong number.
 *
 * In memory, per instance, exactly like the sign-in limiters. On several
 * instances the effective limit is higher, and that is written down rather
 * than pretended about: this is a cost ceiling, not a security boundary.
 * ---------------------------------------------------------------------------
 */
export const UPLOAD_LIMIT = { limit: 60, windowSeconds: 60 * 60 } as const;

/**
 * Writes that are cheap but not free — issues, comments, messages.
 *
 * Generous on purpose. The point is to stop a loop, not to ration a
 * conversation with a contractor.
 */
export const CLIENT_WRITE_LIMIT = { limit: 120, windowSeconds: 60 * 60 } as const;

const uploads: RateLimiter = createRateLimiter(UPLOAD_LIMIT);
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

export function allowUpload(who: string): LimitDecision {
  return decide(uploads, keyFor('upload', who), 'photos');
}

export function allowClientWrite(who: string): LimitDecision {
  return decide(writes, keyFor('write', who), 'messages');
}
