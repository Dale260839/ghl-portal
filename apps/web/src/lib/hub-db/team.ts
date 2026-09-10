import 'server-only';

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, assertScope, type TenantScope } from '../tenancy.ts';
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

/**
 * Roles a contractor may hand out by invitation. FIELD CREW ONLY.
 *
 * ---------------------------------------------------------------------------
 * WHY `client` LEFT THIS LIST (Chris, 2026-09-10)
 *
 * A homeowner no longer gets invited. When the contractor and the homeowner
 * sign, a BuildSuite automation sends them their project code, and that code is
 * their password — `provisionClientFromSignedProject` below opens the account
 * on their first sign-in. Nobody has to remember to invite them, and there is
 * no link to expire between signature and first visit.
 *
 * Leaving `client` here as well would give a homeowner two doors with different
 * rules: one where access follows the signed contract, one where it follows
 * whatever a contractor last ticked. The second is the one that goes stale.
 *
 * `contractor` was never on this list and still is not: minting one is an
 * account-level decision, not a team one.
 * ---------------------------------------------------------------------------
 */
export const INVITABLE_ROLES = ['field'] as const;

/**
 * What `invited_by` says for a homeowner who opened their own account with a
 * project code. A constant because the Team screen compares against it, and a
 * string literal in two places is a label that stops matching after a reword.
 */
export const CLIENT_PROVISIONED_BY = 'Signed contract';
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface Membership {
  id: string;
  contractorId: string;
  /**
   * BuildSuite `auth_profiles.id` values this member may read under.
   *
   * Empty for field crew and clients, who read only the Hub's own tables. A
   * contractor needs at least one, because every BuildSuite read filters on it.
   *
   * **Not the same id as `contractorId`.** Putting one in the other's slot is
   * the bug this column exists to prevent.
   */
  authProfileIds: string[];
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
  auth_profile_ids: string[] | null;
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
    authProfileIds: row.auth_profile_ids ?? [],
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

/**
 * A real hash of a value nobody knows, so an unknown email costs the same as a
 * wrong password. Computed once at load rather than per request.
 */
const DUMMY_HASH_SEED = randomBytes(32).toString('hex');

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
/** Built after hashPassword is defined, hence the placement. */
const DUMMY_HASH = hashPassword(DUMMY_HASH_SEED);

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
    return assertContractor(scope, context);
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
    // Passed per call rather than fixed at construction, because the right
    // answer is the host THIS request arrived on. A base url decided once at
    // startup is how an invitation went out pointing at localhost.
    baseUrl?: string,
  ): Promise<InviteResult> {
    const contractorId = this.contractorOf(scope, 'invite');
    const email = input.email.trim().toLowerCase();
    if (email === '' || !email.includes('@')) throw new Error('a valid email is required');
    if (!(INVITABLE_ROLES as readonly string[]).includes(input.role)) {
      // A contractor cannot mint another contractor. That is an account-level
      // decision, not a team one.
      throw new Error(`${input.role} is not a role a contractor can invite`);
    }

    // A FIELD member inherits the inviter's BuildSuite profiles. The field
    // interface reads the contractor's projects to know what work exists, so a
    // crew member with no profile is bounced straight back out by `assertScope`
    // — which is what happened to the first field invitation.
    //
    // A HOMEOWNER never inherits them, which is the whole privacy model: that
    // would hand them every project the contractor has. Their access is
    // `project_ids` plus the §9.1 gate, and an empty profile list is what keeps
    // BuildSuite closed to them. Clients no longer arrive through this method
    // at all (see `INVITABLE_ROLES`), and `provisionClientFromSignedProject`
    // writes an empty list for exactly this reason.
    const inheritedProfiles =
      input.role === 'field' ? [...assertScope(scope, 'invite').authProfileIds] : [];

    const [membership] = await this.client.insert<MembershipRow>({
      from: 'hub_memberships',
      rows: [
        {
          contractor_id: contractorId,
          auth_profile_ids: inheritedProfiles,
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
      acceptUrl: `${(baseUrl ?? this.appUrl).replace(/\/+$/, '')}/invite/${encodeURIComponent(token)}`,
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

  /**
   * Sign in an invited user.
   *
   * Looks up by email ACROSS contractors, because the person typing it does not
   * know which contractor's tenant they belong to and should not have to.
   *
   * Deliberately no scope argument: this runs before there is a session, so
   * there is no tenant yet. The membership row is what establishes one.
   */
  async authenticate(
    email: string,
    password: string,
  ): Promise<{ ok: true; membership: Membership } | { ok: false; reason: 'unknown' | 'revoked' | 'not-activated' }> {
    const normalized = email.trim().toLowerCase();
    if (normalized === '' || password === '') return { ok: false, reason: 'unknown' };

    const rows = await this.client.select<MembershipRow>({
      from: 'hub_memberships',
      filters: { email: `eq.${normalized}` },
      limit: 5,
    });

    // Verify a password even when no row matched, against a throwaway hash, so
    // the response takes the same time either way. Without it, "unknown email"
    // returns measurably faster than "wrong password" and the endpoint becomes
    // a way to enumerate who has been invited.
    if (rows.length === 0) {
      verifyPassword(password, DUMMY_HASH);
      return { ok: false, reason: 'unknown' };
    }

    for (const row of rows) {
      if (row.password_hash === null) continue;
      if (!verifyPassword(password, row.password_hash)) continue;

      // The password was right. Only now does the account state matter, and
      // these reasons are safe to distinguish because the caller has proved
      // they own the account.
      if (row.revoked_at !== null) return { ok: false, reason: 'revoked' };
      if (row.activated_at === null) return { ok: false, reason: 'not-activated' };

      await this.client.update({
        from: 'hub_memberships',
        filters: { id: `eq.${row.id}` },
        patch: { last_seen_at: new Date().toISOString() },
      });
      return { ok: true, membership: toMembership(row) };
    }

    return { ok: false, reason: 'unknown' };
  }

  /**
   * Open (or re-open) a homeowner's account from a project they have signed.
   *
   * ---------------------------------------------------------------------------
   * THE CALLER HAS ALREADY PROVEN EVERYTHING. THIS ONLY RECORDS IT.
   *
   * `findSignedProjectForClient` matched the code AND the email inside
   * BuildSuite and found a signed proposal on that project. This method takes
   * that answer and nothing else — it does no matching of its own, so there is
   * no second copy of the rule here to drift away from the first.
   *
   * Deliberately no `scope` argument, exactly like `authenticate`: this runs
   * before there is a session. The contractor id arrives from the signed
   * proposal, which is the tenant.
   *
   * ---------------------------------------------------------------------------
   * ONE ROW PER PERSON, NOT ONE PER PROJECT
   *
   * `hub_memberships_live_email` is unique on `(contractor_id, lower(email))`
   * where `revoked_at is null`, so a second row for the same homeowner is
   * impossible — and it should be. Eleven client addresses in BuildSuite
   * already hold more than one project, and §1.4 says never collapse a contact
   * to a single project.
   *
   * So `project_ids` is a UNION: each code proves one project and adds it. It
   * never shrinks here. A contractor who unticks a project on the Team screen
   * will see it come back the next time that project's code is used, because
   * the signed contract still says it is theirs — REVOKE is the control that
   * removes a code-authenticated homeowner, and revoking is checked first and
   * refuses outright.
   *
   * ---------------------------------------------------------------------------
   * `password_hash` STAYS NULL, ALWAYS
   *
   * The project code is verified live against BuildSuite on every sign-in; it
   * is never hashed and stored. Two consequences, both wanted:
   *
   *   · A leak of `hub_memberships` yields no client credential to crack —
   *     and a six-bit code would not survive being cracked at.
   *   · `authenticate()` skips rows whose hash is null, so the password door
   *     stays shut for these accounts. The code door is the only way in.
   * ---------------------------------------------------------------------------
   */
  async provisionClientFromSignedProject(input: {
    contractorId: string;
    email: string;
    projectId: string;
    clientName: string;
  }): Promise<{ ok: true; membership: Membership } | { ok: false; reason: 'revoked' }> {
    const email = input.email.trim().toLowerCase();
    const now = new Date().toISOString();

    // EVERY row for this person, not the most recent one.
    //
    // `hub_memberships_live_email` is unique only WHERE `revoked_at is null`,
    // so a revoked row and a live row can coexist — revoke someone, invite them
    // again, and there are two. Taking `order created_at.desc limit 1` made the
    // answer depend on which was written last, which is not what decides
    // whether somebody has access. A live row always wins; a revoked row only
    // decides the outcome when there is no live row to consider.
    const rows = await this.client.select<MembershipRow>({
      from: 'hub_memberships',
      filters: { contractor_id: `eq.${input.contractorId}`, email: `eq.${email}` },
      order: 'created_at.desc',
      limit: 10,
    });
    const existing = rows.find((r) => r.revoked_at === null);

    if (existing === undefined && rows.length > 0) {
      // Revoked, and nothing live alongside it. The contract being signed is
      // not an argument against the contractor having withdrawn access — this
      // is the one control that overrides the code, and restoring it is the
      // contractor's decision to make on the Team screen, not a side effect of
      // the homeowner typing a code that is still correct.
      return { ok: false, reason: 'revoked' };
    }

    if (existing !== undefined) {

      const projectIds = [...new Set([...(existing.project_ids ?? []), input.projectId])];
      const [updated] = await this.client.update<MembershipRow>({
        from: 'hub_memberships',
        // Both filters. The id says which row; the contractor says whose, so a
        // stale id from elsewhere cannot reach another tenant's member.
        filters: { id: `eq.${existing.id}`, contractor_id: `eq.${input.contractorId}` },
        patch: {
          project_ids: projectIds,
          // Activated the moment they prove the code. There is no separate
          // set-a-password step for them, so leaving this null would leave
          // every homeowner permanently "invited, not yet accepted".
          activated_at: existing.activated_at ?? now,
          last_seen_at: now,
          // NOT touched: role, full_name, auth_profile_ids, password_hash. A
          // homeowner who was also invited as field crew before this flow
          // existed must not be silently demoted by signing a contract.
        },
      });
      return { ok: true, membership: toMembership(updated ?? existing) };
    }

    const [created] = await this.client.insert<MembershipRow>({
      from: 'hub_memberships',
      rows: [
        {
          contractor_id: input.contractorId,
          // Empty, and load-bearing: a homeowner reads only the Hub's own
          // tables, and an inherited profile would open BuildSuite to them.
          auth_profile_ids: [],
          email,
          full_name: input.clientName,
          role: 'client',
          project_ids: [input.projectId],
          activated_at: now,
          last_seen_at: now,
          // Shown on the Team screen where an inviter's name would be, so a
          // contractor can tell at a glance which homeowners let themselves in
          // with a code and which they added by hand.
          invited_by: CLIENT_PROVISIONED_BY,
        },
      ],
    });

    return { ok: true, membership: toMembership(created!) };
  }

  /**
   * Re-read a membership and its ticks on every request that needs them.
   *
   * NOT cached in the session on purpose. A session lasts eight hours; a
   * contractor who revokes access or unticks a resource expects that to take
   * effect now, not at the invitee's next login. One small query is the price
   * of revocation meaning what it says.
   */
  async currentAccess(
    membershipId: string,
  ): Promise<{ membership: Membership; grants: Record<string, boolean> } | null> {
    const [row] = await this.client.select<MembershipRow>({
      from: 'hub_memberships',
      filters: { id: `eq.${membershipId}` },
      limit: 1,
    });
    if (row === undefined || row.revoked_at !== null) return null;

    const grantRows = await this.client.select<{ resource: string; allowed: boolean }>({
      from: 'hub_grants',
      filters: { membership_id: `eq.${membershipId}` },
      limit: 100,
    });

    return {
      membership: toMembership(row),
      grants: Object.fromEntries(grantRows.map((g) => [g.resource, g.allowed])),
    };
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
  /**
   * Which projects a member may see.
   *
   * Separate from `setGrants` because they answer different questions: grants
   * are WHAT someone may do, this is WHICH work they may do it on. Conflating
   * them was how an invited person ended up with permissions over nothing.
   *
   * The contractor id is asserted from the scope and used as a filter on the
   * update, so a membership belonging to another contractor cannot be
   * reassigned even if its id is known.
   */
  async setProjects(
    scope: TenantScope,
    membershipId: string,
    projectIds: string[],
  ): Promise<void> {
    const contractorId = this.contractorOf(scope, 'set projects');
    await this.client.update({
      from: 'hub_memberships',
      filters: { id: `eq.${membershipId}`, contractor_id: `eq.${contractorId}` },
      patch: { project_ids: projectIds, updated_at: new Date().toISOString() },
    });
  }

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
