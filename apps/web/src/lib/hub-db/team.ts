import 'server-only';

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { getHubClient, type HubClient } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';
import { sign, verify } from '../auth/session-crypto.ts';
import type { Role } from '../demo-accounts.ts';

/**
 * The contractor's team — who has access, and to what.
 *
 * A contractor invites their superintendent and their homeowner by email. The
 * invitee follows a single-use link, sets a password, and lands in the right
 * experience. None of this lives in BuildSuite: `auth_profiles.user_type` has no
 * `field` value, and adding one would be a write to someone else's production
 * table.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THE WHOLE FILE TURNS ON
 *
 *   EFFECTIVE PERMISSION = ROLE MATRIX **AND** GRANT. NEVER OR.
 *
 * The role is the ceiling; a tick can only narrow it. A field user cannot be
 * ticked into seeing margins, because the role forbids it and the matrix is
 * closed by default. If these were OR'd, a tick box would become a way to grant
 * something dangerous by accident — which is precisely how a homeowner ends up
 * looking at a contractor's margin.
 * ---------------------------------------------------------------------------
 */

export const INVITE_PURPOSE = 'hub-invite';

/**
 * Seven days. Long enough that a superintendent who is on site all week can
 * still use it; short enough that a forwarded link is not a standing credential.
 */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Roles a contractor may hand out. Deliberately not `contractor`. */
export const INVITABLE_ROLES = ['field', 'client'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface Membership {
  id: string;
  contractorId: string;
  email: string;
  fullName: string;
  role: Role;
  projectIds: string[];
  activated: boolean;
  activatedAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
  lastSeenAt: string | null;
  invitedBy: string | null;
  createdAt: string;
}

interface MembershipRow {
  id: string;
  contractor_id: string;
  email: string;
  full_name: string | null;
  role: string;
  project_ids: string[] | null;
  activated_at: string | null;
  password_hash: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  invited_by: string | null;
}

function toMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    contractorId: row.contractor_id,
    email: row.email,
    fullName: row.full_name ?? '',
    role: row.role as Role,
    projectIds: row.project_ids ?? [],
    activated: row.activated_at !== null,
    activatedAt: row.activated_at,
    revoked: row.revoked_at !== null,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  };
}

export interface Grant {
  membershipId: string;
  resource: string;
  allowed: boolean;
}

// ── Passwords ───────────────────────────────────────────────────────────────

/**
 * scrypt, from the standard library. No dependency, and deliberately slow.
 *
 * Format: `scrypt$<N>$<salt-hex>$<hash-hex>`. The cost is stored alongside the
 * hash so it can be raised later without invalidating existing passwords.
 */
const SCRYPT_COST = 16_384;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024) return false;

  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  const actual = scryptSync(password, salt, expected.length, { N: cost });

  // Length is checked first: timingSafeEqual throws on a mismatch, and the
  // throw would itself leak that the lengths differed.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── Invitation tokens ───────────────────────────────────────────────────────

/**
 * Only the HASH is stored. The raw token exists in the emailed link and nowhere
 * else, so someone holding a dump of `hub_invitations` still cannot accept an
 * invitation.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface InvitePayload {
  purpose: typeof INVITE_PURPOSE;
  email: string;
  role: InvitableRole;
  contractorId: string;
  jti: string;
}

export function issueInviteToken(
  input: { email: string; role: InvitableRole; contractorId: string },
  secret: string,
  options: { ttlSeconds?: number; now?: number; jti?: string } = {},
): string {
  return sign(
    {
      // A session carries a `role` and no `purpose`; this carries a purpose. A
      // session cookie handed to the accept path fails the purpose check, and
      // an invite token handed to `getSession` fails the role check.
      purpose: INVITE_PURPOSE,
      email: input.email.trim().toLowerCase(),
      role: input.role,
      contractorId: input.contractorId,
      jti: options.jti ?? randomBytes(16).toString('base64url'),
    },
    secret,
    { ttlSeconds: options.ttlSeconds ?? INVITE_TTL_SECONDS, now: options.now },
  );
}

export type InviteCheck =
  | { valid: true; payload: InvitePayload }
  | { valid: false; reason: 'malformed' | 'expired' | 'wrong-purpose' };

/** `now` is EPOCH SECONDS, matching `session-crypto` — not milliseconds. */
export function readInviteToken(token: string, secret: string, now?: number): InviteCheck {
  const result = verify<InvitePayload>(token, secret, { now });
  if (!result.valid) {
    return { valid: false, reason: result.reason === 'expired' ? 'expired' : 'malformed' };
  }
  if (result.payload.purpose !== INVITE_PURPOSE) {
    return { valid: false, reason: 'wrong-purpose' };
  }
  return { valid: true, payload: result.payload };
}

// ── The repository ──────────────────────────────────────────────────────────

export interface InviteResult {
  membership: Membership;
  /**
   * The raw token, returned EXACTLY ONCE and never stored.
   *
   * Surfaced so the contractor can copy the link when no mail sender is
   * configured. That is not a stopgap that leaks a secret — it is the same link
   * the email would contain, handed to the person who is allowed to send it.
   */
  token: string;
  acceptUrl: string;
}

export class HubTeam {
  private readonly client: HubClient;
  private readonly secret: string;
  private readonly appUrl: string;

  constructor(client: HubClient, secret: string, appUrl: string) {
    this.client = client;
    this.secret = secret;
    this.appUrl = appUrl.replace(/\/+$/, '');
  }

  private contractorOf(scope: TenantScope, context: string): string {
    return assertScope(scope, context).authProfileIds[0]!;
  }

  async listTeam(scope: TenantScope): Promise<Membership[]> {
    const contractorId = this.contractorOf(scope, 'team');
    const rows = await this.client.select<MembershipRow>({
      from: 'hub_memberships',
      filters: { contractor_id: `eq.${contractorId}` },
      order: 'created_at.desc',
      limit: 200,
    });
    return rows.map(toMembership);
  }

  async listGrants(scope: TenantScope): Promise<Grant[]> {
    const contractorId = this.contractorOf(scope, 'grants');
    const rows = await this.client.select<{
      membership_id: string;
      resource: string;
      allowed: boolean;
    }>({
      from: 'hub_grants',
      filters: { contractor_id: `eq.${contractorId}` },
      limit: 500,
    });
    return rows.map((r) => ({
      membershipId: r.membership_id,
      resource: r.resource,
      allowed: r.allowed,
    }));
  }

  /**
   * Invite someone. Creates the membership and the invitation in one step.
   *
   * The membership exists before acceptance on purpose: the contractor should
   * see "invited, not yet accepted" on the Team screen rather than the invite
   * vanishing into an email they cannot track.
   */
  async invite(
    scope: TenantScope,
    input: { email: string; fullName: string; role: InvitableRole; projectIds: string[] },
    actor: { name: string },
  ): Promise<InviteResult> {
    const contractorId = this.contractorOf(scope, 'invite');
    const email = input.email.trim().toLowerCase();
    if (email === '' || !email.includes('@')) throw new Error('a valid email is required');
    if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) {
      // A contractor cannot mint another contractor. That is an account-level
      // decision, not a team one.
      throw new Error(`${input.role} is not a role a contractor can invite`);
    }

    const [membership] = await this.client.insert<MembershipRow>({
      from: 'hub_memberships',
      rows: [
        {
          contractor_id: contractorId,
          email,
          full_name: input.fullName.trim(),
          role: input.role,
          project_ids: input.projectIds,
          invited_by: actor.name,
        },
      ],
    });

    const token = issueInviteToken({ email, role: input.role, contractorId }, this.secret);
    await this.client.insert({
      from: 'hub_invitations',
      rows: [
        {
          contractor_id: contractorId,
          membership_id: membership!.id,
          email,
          role: input.role,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + INVITE_TTL_SECONDS * 1000).toISOString(),
          created_by: actor.name,
        },
      ],
    });

    return {
      membership: toMembership(membership!),
      token,
      acceptUrl: `${this.appUrl}/invite/${encodeURIComponent(token)}`,
    };
  }

  /**
   * Redeem an invitation and set a password.
   *
   * Single use is enforced by the DATABASE row, not by an in-memory set: the
   * row's `accepted_at` is checked and then written. That survives a restart and
   * is shared across serverless instances, which the existing client-verify
   * flow's memory store is not.
   */
  async acceptInvite(
    token: string,
    password: string,
    now: Date = new Date(),
  ): Promise<
    | { ok: true; membership: Membership }
    | { ok: false; reason: 'invalid' | 'expired' | 'already-used' | 'revoked' | 'weak-password' }
  > {
    // Seconds, not milliseconds — `verify` compares against `exp`, which is a
    // unix timestamp in seconds. Passing `getTime()` makes every token look
    // expired by a factor of a thousand.
    const check = readInviteToken(token, this.secret, Math.floor(now.getTime() / 1000));
    if (!check.valid) {
      return { ok: false, reason: check.reason === 'expired' ? 'expired' : 'invalid' };
    }
    if (password.length < 10) return { ok: false, reason: 'weak-password' };

    const [invitation] = await this.client.select<{
      id: string;
      membership_id: string;
      accepted_at: string | null;
      revoked_at: string | null;
      expires_at: string;
    }>({
      from: 'hub_invitations',
      filters: { token_hash: `eq.${hashToken(token)}` },
      limit: 1,
    });

    // A valid signature whose row is gone means the invitation was withdrawn.
    if (invitation === undefined) return { ok: false, reason: 'invalid' };
    if (invitation.revoked_at !== null) return { ok: false, reason: 'revoked' };
    if (invitation.accepted_at !== null) return { ok: false, reason: 'already-used' };
    if (new Date(invitation.expires_at) < now) return { ok: false, reason: 'expired' };

    const [membership] = await this.client.update<MembershipRow>({
      from: 'hub_memberships',
      filters: { id: `eq.${invitation.membership_id}` },
      patch: {
        activated_at: now.toISOString(),
        password_hash: hashPassword(password),
        updated_at: now.toISOString(),
      },
    });

    // Marked spent AFTER the membership is activated. The other order would burn
    // the invitation on a failed activation and leave someone locked out with a
    // link that no longer works.
    await this.client.update({
      from: 'hub_invitations',
      filters: { id: `eq.${invitation.id}` },
      patch: { accepted_at: now.toISOString() },
    });

    return { ok: true, membership: toMembership(membership!) };
  }

  async revoke(scope: TenantScope, membershipId: string, actor: { name: string }): Promise<void> {
    const contractorId = this.contractorOf(scope, 'revoke');

    // Both filters: the id says which, the contractor says whose.
    await this.client.update({
      from: 'hub_memberships',
      filters: { id: `eq.${membershipId}`, contractor_id: `eq.${contractorId}` },
      patch: { revoked_at: new Date().toISOString(), revoked_by: actor.name },
    });
  }

  async restore(scope: TenantScope, membershipId: string): Promise<void> {
    const contractorId = this.contractorOf(scope, 'restore access');
    await this.client.update({
      from: 'hub_memberships',
      filters: { id: `eq.${membershipId}`, contractor_id: `eq.${contractorId}` },
      patch: { revoked_at: null, revoked_by: null },
    });
  }

  /** Set the permission ticks for one person. */
  async setGrants(
    scope: TenantScope,
    membershipId: string,
    grants: Record<string, boolean>,
    actor: { name: string },
  ): Promise<void> {
    const contractorId = this.contractorOf(scope, 'set grants');
    const rows = Object.entries(grants).map(([resource, allowed]) => ({
      membership_id: membershipId,
      contractor_id: contractorId,
      resource,
      allowed,
      updated_at: new Date().toISOString(),
      updated_by: actor.name,
    }));
    if (rows.length === 0) return;

    await this.client.upsert({ from: 'hub_grants', rows }, 'membership_id,resource');
  }
}

export type HubTeamResult =
  | { available: true; team: HubTeam }
  | { available: false; missing: string[] };

export function getHubTeam(): HubTeamResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };

  const secret = process.env.SESSION_SECRET;
  if (secret === undefined || secret.trim() === '') {
    return { available: false, missing: ['SESSION_SECRET'] };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return { available: true, team: new HubTeam(hub.client, secret, appUrl) };
}
