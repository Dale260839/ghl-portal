import 'server-only';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { Session } from '../demo-accounts.ts';
import type { HubClient } from '../hub-db/client.ts';
import { sign, verify, type SignedPayload } from './session-crypto.ts';

const PURPOSE = 'hub-browser-handoff';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function canOpenWorkspace(session: Session | null): boolean {
  return session !== null && session.role === 'contractor' && session.ghlIdentityVerified === true &&
    session.ghlEmbedded === true && typeof session.ghlLocationId === 'string' && !!session.ghlLocationId &&
    typeof session.ghlUserId === 'string' && !!session.ghlUserId &&
    !session.membershipId && !session.returnTo && Array.isArray(session.authProfileIds) &&
    session.authProfileIds.length > 0 && session.authProfileIds.every(id => typeof id === 'string' && !!id);
}

export class BrowserHandoffs {
  private client: Pick<HubClient, 'rpc'>;
  private secret: string;
  constructor(client: Pick<HubClient, 'rpc'>, secret: string) {
    this.client = client;
    this.secret = secret;
  }

  async issue(session: Session & SignedPayload, now = Math.floor(Date.now() / 1000)) {
    if (!canOpenWorkspace(session) || !Number.isSafeInteger(session.exp) || session.exp <= now ||
        session.exp - now > 8 * 60 * 60) throw new Error('Verified embedded session required');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Math.min(now + 120, session.exp);
    const sessionToken = sign({ ...session, purpose: PURPOSE, ghlEmbedded: false }, this.secret,
      { now, ttlSeconds: session.exp - now });
    const ownerHash = createHmac('sha256', this.secret).update(JSON.stringify([
      session.ghlUserId, session.ghlLocationId, session.authProfileIds,
    ])).digest('hex');
    await this.client.rpc('hub_create_browser_handoff', {
      p_token_hash: hash(token), p_owner_hash: ownerHash, p_session_token: sessionToken,
      p_expires_at: new Date(expiresAt * 1000).toISOString(),
    });
    return { token, expiresAt };
  }

  async redeem(token: string, now = Math.floor(Date.now() / 1000)) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const stored = await this.client.rpc<string | null>('hub_consume_browser_handoff', { p_token_hash: hash(token) });
    const reading = verify<Session & { purpose?: string }>(stored, this.secret, { now });
    if (!reading.valid) return null;
    const { purpose, iat: _iat, exp, ...session } = reading.payload;
    if (purpose !== PURPOSE || session.ghlEmbedded !== false ||
        !canOpenWorkspace({ ...session, ghlEmbedded: true }) || !Number.isSafeInteger(exp) ||
        exp - now > 8 * 60 * 60) return null;
    return { session, expiresAt: exp };
  }
}
