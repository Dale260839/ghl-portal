import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';

/**
 * Reading BuildSuite's `proposals` — where matching and signature actually live.
 *
 * ---------------------------------------------------------------------------
 * THIS TABLE CORRECTS A CLAIM THIS CODEBASE HAS BEEN MAKING FOR DAYS.
 *
 * "No deal has ever been signed — 0 of 182" was measured against
 * `deals.signature_signed_at`, which BuildSuite does not populate. Signature is
 * recorded here. Measured 2026-08-31 across 46 proposals:
 *
 *   status         draft 27 · submitted 15 · accepted 4
 *   SIGNED         4, each with an adobe_agreement_id and a signed_pdf_url
 *   contractor_id  34 of 46
 *
 * So a job HAS been signed — four proposals in February 2026, all on one
 * project. And the contractor match is `proposals.contractor_id` (34), not
 * `deals.matched_contractor_id` (5). The deal funnel answers "who applied";
 * this answers "who is doing the work, for how much, and did they sign".
 * ---------------------------------------------------------------------------
 *
 * Read-only, like every BuildSuite read. Anything the Hub writes goes to the
 * Hub's own database.
 */

/**
 * Narrow on purpose. Deliberately NOT selected: `content`, `sections`,
 * `pdf_url`, `docx_url`, `signed_pdf_url` (documents the Hub has no screen
 * for), `ai_feedback`, `notes`, `share_feedback` (internal to BuildSuite), and
 * `acceptance_notes` / `rejection_feedback` (never populated, and client-facing
 * text we have no mandate to surface).
 */
export const PROPOSAL_COLUMNS = [
  'id',
  'project_id',
  'contractor_id',
  'status',
  'price',
  'subtotal',
  'total',
  'valid_until',
  'timeline',
  'created_at',
  'updated_at',
  'submitted_at',
  'accepted_at',
  'rejected_at',
  'signature_status',
  'signature_sent_at',
  'signature_signed_at',
  'source_deal_id',
  'deleted_at',
] as const;

/** Observed 2026-08-31. Treated as open — an unknown value is surfaced, not dropped. */
export const PROPOSAL_STATUSES = ['draft', 'submitted', 'accepted', 'rejected'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number] | (string & {});

/**
 * A placeholder BuildSuite writes when no contractor is attached. It is a real
 * UUID, so a plain null-check would read it as a genuine match.
 */
export const NO_CONTRACTOR = '00000000-0000-0000-0000-000000000000';

export interface BuildSuiteProposalRow {
  id: string;
  project_id: string;
  contractor_id: string | null;
  status: string | null;
  price: string | number | null;
  subtotal: number | null;
  total: number | null;
  valid_until: string | null;
  timeline: string | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  signature_status: string | null;
  signature_sent_at: string | null;
  signature_signed_at: string | null;
  source_deal_id: string | null;
  deleted_at: string | null;
}

export interface Proposal {
  id: string;
  projectId: string;
  /** null when unattached — the all-zero placeholder is normalized away. */
  contractorId: string | null;
  status: ProposalStatus;
  /** Free text on 46 of 46 (`price`); the numeric `total` is set on only 8. */
  priceText: string;
  /** The real number when BuildSuite has one, else null. Never guessed. */
  amount: number | null;
  timeline: string;
  createdAt: string;
  updatedAt: string;
  submitted: boolean;
  accepted: boolean;
  rejected: boolean;
  /** A signature has been captured. THIS is what "won" means. */
  signed: boolean;
  signatureStatus: string;
  signedAt: string | null;
  /** The deal this proposal came from, when BuildSuite recorded one (4 of 46). */
  sourceDealId: string | null;
  archived: boolean;
}

function nonEmpty(value: unknown): string {
  return value === null || value === undefined || String(value).trim() === ''
    ? ''
    : String(value).trim();
}

export function normalizeProposal(row: BuildSuiteProposalRow): Proposal {
  const contractor = nonEmpty(row.contractor_id);
  const status = nonEmpty(row.status) || 'unknown';

  // `total` is populated on 8 of 46; `price` is free text on all of them. Only a
  // real number is treated as an amount — parsing "around 12k" into 12000 is the
  // kind of helpfulness that puts a wrong figure on a contract.
  const amount =
    typeof row.total === 'number' && Number.isFinite(row.total)
      ? row.total
      : typeof row.subtotal === 'number' && Number.isFinite(row.subtotal)
        ? row.subtotal
        : null;

  return {
    id: row.id,
    projectId: row.project_id,
    contractorId: contractor === '' || contractor === NO_CONTRACTOR ? null : contractor,
    status,
    priceText: nonEmpty(row.price),
    amount,
    timeline: nonEmpty(row.timeline),
    createdAt: nonEmpty(row.created_at),
    updatedAt: nonEmpty(row.updated_at) || nonEmpty(row.created_at),
    submitted: nonEmpty(row.submitted_at) !== '' || status === 'submitted' || status === 'accepted',
    accepted: status === 'accepted' || nonEmpty(row.accepted_at) !== '',
    rejected: status === 'rejected' || nonEmpty(row.rejected_at) !== '',
    signed: nonEmpty(row.signature_signed_at) !== '' || nonEmpty(row.signature_status).toUpperCase() === 'SIGNED',
    signatureStatus: nonEmpty(row.signature_status),
    signedAt: nonEmpty(row.signature_signed_at) === '' ? null : row.signature_signed_at,
    sourceDealId: nonEmpty(row.source_deal_id) === '' ? null : row.source_deal_id,
    archived: nonEmpty(row.deleted_at) !== '',
  };
}

/**
 * Is this proposal live work — something a project manager should be running?
 *
 * Submitted or accepted, not rejected, not soft-deleted. A draft is BuildSuite's
 * business: nobody outside has seen it, so there is nothing to manage yet.
 */
export function isLiveEngagement(proposal: Proposal): boolean {
  if (proposal.archived || proposal.rejected) return false;
  return proposal.submitted || proposal.accepted || proposal.signed;
}

/**
 * The proposal that represents a project, when several point at it.
 *
 * Four of the four signed proposals in the database are duplicates on the same
 * project, so this is not hypothetical. Signed beats accepted beats submitted;
 * ties break on the most recent. Without an explicit rule, whichever row
 * PostgREST returned first would decide whether a contractor sees a signed job.
 */
export function pickCurrentProposal(proposals: Proposal[]): Proposal | null {
  const rank = (p: Proposal): number => (p.signed ? 3 : p.accepted ? 2 : p.submitted ? 1 : 0);

  return proposals
    .filter((p) => !p.archived && !p.rejected)
    .reduce<Proposal | null>((best, p) => {
      if (best === null) return p;
      const d = rank(p) - rank(best);
      if (d > 0) return p;
      if (d < 0) return best;
      return p.updatedAt > best.updatedAt ? p : best;
    }, null);
}

// ── The reader ──────────────────────────────────────────────────────────────

export interface BuildSuiteProposalsReader {
  readonly available: true;
  /** Every proposal for a set of projects. Scope is required. */
  listForProjects(scope: TenantScope, projectIds: string[]): Promise<Proposal[]>;
  /**
   * One proposal's markdown document, for the payment schedule inside it.
   * Kept off `PROPOSAL_COLUMNS` because it is ~4.6KB per row.
   */
  readContent(scope: TenantScope, projectId: string, proposalId: string): Promise<string | null>;
  /**
   * This contractor's live engagements.
   *
   * `contractorId` is REQUIRED. `proposals` has no `auth_profile_id`, so
   * without it a "scoped" read returns every contractor's work to anyone
   * signed in — exactly the leak found in August. Resolve it with
   * `resolveContractor` and show nothing when it cannot be resolved.
   */
  listLive(scope: TenantScope, contractorId: string, limit?: number): Promise<Proposal[]>;
}

export interface ProposalsUnavailable {
  readonly available: false;
  readonly missing: string[];
}

/** Exported for tests, which drive it with a fake fetch. Prefer `getProposalsReader`. */
export class SupabaseProposalsReader implements BuildSuiteProposalsReader {
  readonly available = true as const;
  private readonly client: BuildSuiteClient;

  constructor(client: BuildSuiteClient) {
    this.client = client;
  }

  /**
   * `proposals` carries no `auth_profile_id`, so it cannot be tenant-filtered on
   * its own. The scope is enforced by only ever asking about project ids the
   * caller already resolved through a scoped read — hence no unscoped overload,
   * and hence `assertScope` here even though the filter is on `project_id`.
   */
  async listForProjects(scope: TenantScope, projectIds: string[]): Promise<Proposal[]> {
    assertScope(scope, 'proposals');
    if (projectIds.length === 0) return [];

    const rows = await this.client.select<BuildSuiteProposalRow>({
      from: 'proposals',
      columns: PROPOSAL_COLUMNS,
      filters: { project_id: `in.(${projectIds.join(',')})` },
      limit: 500,
    });
    return rows.map(normalizeProposal);
  }

  /**
   * The proposal document itself, for ONE proposal.
   *
   * `content` is excluded from `PROPOSAL_COLUMNS` and stays excluded: it is
   * ~4.6KB of markdown per row, and pulling it on every list to read one
   * payment schedule would multiply every proposal query by the size of a
   * document nothing else on the screen uses.
   *
   * Scoped the same way `listForProjects` is — by only ever being asked about
   * a project id the caller already resolved through a scoped read. The filter
   * carries the project id as well as the proposal id so a known proposal id
   * alone cannot pull another tenant's document.
   */
  async readContent(
    scope: TenantScope,
    projectId: string,
    proposalId: string,
  ): Promise<string | null> {
    assertScope(scope, 'proposal content');
    if (projectId.trim() === '' || proposalId.trim() === '') return null;

    const rows = await this.client.select<{ content: string | null }>({
      from: 'proposals',
      columns: ['content'],
      filters: { id: `eq.${proposalId}`, project_id: `eq.${projectId}` },
      limit: 1,
    });
    return rows[0]?.content ?? null;
  }

  async listLive(scope: TenantScope, contractorId: string, limit = 200): Promise<Proposal[]> {
    assertScope(scope, 'live proposals');

    // Refused rather than defaulted. An empty contractor id would produce
    // `contractor_id=eq.` which PostgREST treats as a match on empty string,
    // and the failure would look like "no work" rather than "no filter".
    if (contractorId.trim() === '') {
      throw new TypeError(
        'listLive requires a contractor id — proposals carry no auth_profile_id, so an unfiltered read would expose every contractor',
      );
    }

    const rows = await this.client.select<BuildSuiteProposalRow>({
      from: 'proposals',
      columns: PROPOSAL_COLUMNS,
      filters: {
        contractor_id: `eq.${contractorId}`,
        status: 'in.(submitted,accepted)',
      },
      order: 'updated_at.desc',
      limit,
    });
    return rows.map(normalizeProposal).filter(isLiveEngagement);
  }
}

let cached: BuildSuiteProposalsReader | ProposalsUnavailable | null = null;

export function getProposalsReader(): BuildSuiteProposalsReader | ProposalsUnavailable {
  if (cached !== null) return cached;
  const result = readBuildSuiteConfig();
  cached = result.configured
    ? new SupabaseProposalsReader(new BuildSuiteClient(result.config))
    : { available: false, missing: result.missing };
  return cached;
}

/** Test seam — the module-level cache must not leak between tests. */
export function resetProposalsReader(): void {
  cached = null;
}
