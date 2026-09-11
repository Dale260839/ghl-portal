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
  // The signed contract itself. Sing confirmed 2026-09-09 that this is where
  // it lives; there is no such column on `projects`.
  'signed_pdf_url',
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
  signed_pdf_url: string | null;
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

/**
 * A `price` string that is EXACTLY one number, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SAFE, WHEN "PARSE THE FREE TEXT" USUALLY IS NOT
 *
 * `price` holds two shapes and only two — measured across all 48 rows on
 * 2026-09-09:
 *
 *   33  a single number, e.g. "24500.00" or "8000.0"
 *   15  a band,          e.g. "$2,000 - $5,000"
 *
 * The whole string must match. A band contains a hyphen and cannot, so it
 * falls through to null rather than being read as its first figure — which
 * would quote a homeowner $2,000 for a job that might cost $5,000.
 *
 * This is NOT the same as parsing "around 12k" into 12000. That would be
 * inferring a number from prose; this is reading a number that is already a
 * number and happens to be stored as text.
 * ---------------------------------------------------------------------------
 */
/**
 * A URL we would actually put behind a link, or null.
 *
 * `nonEmpty` is not enough here. One live row stores the four-character STRING
 * "null" rather than SQL NULL, which is truthy and non-empty — so the screen
 * rendered `<a href="null">Signed contract</a>`: a dead link labelled as the
 * signed contract, which is worse than no link at all because a contractor
 * would report the document as missing.
 *
 * Also requires it to look like a link. A value that is neither absent nor a
 * URL is a data fault, and guessing at it would put something unopenable in
 * front of a person about to invoice against it.
 */
function usableUrl(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^(null|undefined|none|n\/a|false|0)$/i.test(text)) return null;
  return /^https?:\/\//i.test(text) ? text : null;
}

const EXACT_PRICE = /^\$?\s*[\d,]+(?:\.\d{1,2})?$/;

function exactPrice(value: string | number | null): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (text === '' || !EXACT_PRICE.test(text)) return null;

  const parsed = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The contract amount, and where it came from.
 *
 * Numeric columns first, because they are typed. `price` last, because it is
 * text — and only when the whole of it is a number. Adding the `price` path
 * took exact pricing from 10 of 48 proposals to 33.
 */
function resolveAmount(row: {
  total: number | null;
  subtotal: number | null;
  price: string | number | null;
}): { amount: number | null; amountSource: Proposal['amountSource'] } {
  if (typeof row.total === 'number' && Number.isFinite(row.total)) {
    return { amount: row.total, amountSource: 'total' };
  }
  if (typeof row.subtotal === 'number' && Number.isFinite(row.subtotal)) {
    return { amount: row.subtotal, amountSource: 'subtotal' };
  }
  const fromPrice = exactPrice(row.price);
  if (fromPrice !== null) return { amount: fromPrice, amountSource: 'price' };
  return { amount: null, amountSource: 'none' };
}

export interface Proposal {
  id: string;
  projectId: string;
  /** null when unattached — the all-zero placeholder is normalized away. */
  contractorId: string | null;
  status: ProposalStatus;
  /** Free text on every row (`price`); the numeric `total` is set on 10 of 48. */
  priceText: string;
  /** The real number when BuildSuite has one, else null. Never guessed. */
  amount: number | null;
  /** Where `amount` came from, so a screen can say so rather than imply it. */
  amountSource: 'total' | 'subtotal' | 'price' | 'none';
  /**
   * A link to the signed contract PDF, when one exists.
   *
   * ---------------------------------------------------------------------------
   * THIS URL IS PUBLIC AND UNAUTHENTICATED. TREAT IT AS SENSITIVE.
   *
   * Sing, 2026-09-09: anyone holding the URL can open the client's signed
   * contract — prices, address, the lot. There is no auth on it.
   *
   * So it may be LINKED from a page that is already behind login, and it must
   * not travel any further than that: not into an email, not into anything
   * shared or indexed, and never into a client-facing projection. Chris has not
   * ruled on it, so the conservative reading holds until he does.
   *
   * `rel="noreferrer"` on every link, so the storage host is not told which
   * page it was opened from. A guardrail test keeps it out of the portal.
   * ---------------------------------------------------------------------------
   *
   * Written by the GoHighLevel webhook from the document's `pdfLink`, so it
   * stays null on a test fire — their test payload carries no document fields.
   * Only a real signature populates it.
   *
   * Lives on the proposal, NOT on `projects`. `deals.signed_pdf_url` is written
   * at the same moment but is the contractor-side copy; the Hub reads proposals,
   * where the link, the total and `signature_status` arrive together.
   */
  signedPdfUrl: string | null;
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

  // `total` is populated on 10 of 48 (2026-09-09), including two SIGNED rows.
  // `price` is free text and holds BOTH shapes — a band like "$2,000 - $5,000"
  // on older rows and a numeric string like "24500.00" on newer ones. It is
  // never parsed for money: only the numeric columns are, because turning
  // "around 12k" into 12000 is the kind of helpfulness that puts a wrong figure
  // on a contract.
  const { amount, amountSource } = resolveAmount(row);

  return {
    id: row.id,
    projectId: row.project_id,
    contractorId: contractor === '' || contractor === NO_CONTRACTOR ? null : contractor,
    status,
    priceText: nonEmpty(row.price),
    amount,
    amountSource,
    signedPdfUrl: usableUrl(row.signed_pdf_url),
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
  readSchedule(
    scope: TenantScope,
    projectId: string,
    proposalId: string,
  ): Promise<{ content: string | null; sections: unknown }>;
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
  /**
   * The two columns a payment schedule can live in, for one proposal.
   *
   * Was `readContent`, which returned markdown only — and the schedule lives
   * in `sections` on 8 of 48 proposals, INCLUDING the signed test record the
   * pilot runs on. A screen reading only `content` shows that record zero
   * invoice lines and looks like a parser bug.
   *
   * Both are read in one request. They stay out of the standard column list
   * because `content` is ~4.6KB of markdown per row.
   */
  async readSchedule(
    scope: TenantScope,
    projectId: string,
    proposalId: string,
  ): Promise<{ content: string | null; sections: unknown }> {
    assertScope(scope, 'proposal schedule');
    if (projectId.trim() === '' || proposalId.trim() === '') {
      return { content: null, sections: null };
    }

    const rows = await this.client.select<{ content: string | null; sections: unknown }>({
      from: 'proposals',
      columns: ['content', 'sections'],
      filters: { id: `eq.${proposalId}`, project_id: `eq.${projectId}` },
      limit: 1,
    });
    return { content: rows[0]?.content ?? null, sections: rows[0]?.sections ?? null };
  }

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
    const live = rows.map(normalizeProposal).filter(isLiveEngagement);
    if (live.length === 0) return live;

    const lost = await this.projectsWonByAnother(scope, contractorId, live);
    return lost.size === 0 ? live : live.filter((p) => !lost.has(p.projectId));
  }

  /**
   * Projects where ANOTHER contractor's proposal has been signed.
   *
   * ---------------------------------------------------------------------------
   * THE GAP (Chris, huddle 2026-09-10)
   *
   *   > when multiple contractors bid on a project, only the awarded contractor
   *   > should retain access while others are blocked
   *
   * The project itself was already closed to a losing bidder: project reads
   * filter on the award (`awarded_to_auth_profile_id`) or, unawarded, the
   * owner — and nothing lists a project for a contractor who did not win it.
   * But `listLive` reads proposals by `contractor_id`
   * and status alone, so a losing bidder's quote stayed "live" — on their
   * Engagements screen, and on Invoices, where it can seed an invoice draft for
   * a job somebody else won.
   *
   * Live on 2026-09-12: one project (`87a42c43…`) carries quotes from two
   * contractors. `5dd312bd` signed four; `ff4a29d8` still had two `submitted`
   * quotes showing as live work.
   *
   * ---------------------------------------------------------------------------
   * "SOMEONE ELSE" HAS TO BE PROVEN, NOT ASSUMED
   *
   * `contractor_id` is null on 13 of 48 proposals, including one signed one.
   * So a signed proposal is MINE when either key says so — its `contractor_id`
   * is this contractor, or its `user_id` is one of this tenant's own auth
   * profiles (`BSA-APS-001`'s signed proposal has no contractor id and is
   * Alliance Pro Services' by `user_id`).
   *
   * A signed proposal carrying NEITHER key cannot be attributed, and is not
   * treated as anyone else's win. Hiding a contractor's own signed job because
   * its row is half-written is the worse failure: they would lose the job from
   * their own screens, while a stale quote staying visible to a loser is the
   * behaviour this replaces, not a new harm.
   * ---------------------------------------------------------------------------
   */
  private async projectsWonByAnother(
    scope: TenantScope,
    contractorId: string,
    live: Proposal[],
  ): Promise<Set<string>> {
    const safe = assertScope(scope, 'lost bids');
    const projectIds = [...new Set(live.map((p) => p.projectId).filter((id) => id.trim() !== ''))];
    if (projectIds.length === 0) return new Set();

    const signed = await this.client.select<{
      project_id: string | null;
      contractor_id: string | null;
      user_id: string | null;
    }>({
      from: 'proposals',
      // Narrow on purpose: whose, and on which project. Nothing about the
      // other contractor's price or document reaches this process.
      columns: ['project_id', 'contractor_id', 'user_id'],
      filters: {
        project_id: `in.(${projectIds.join(',')})`,
        signature_status: 'eq.SIGNED',
        signature_signed_at: 'not.is.null',
        deleted_at: 'is.null',
      },
      limit: 500,
    });

    // ONE definition of "mine". It was written twice — once to find wins by
    // others and again to rescue projects I had also signed — and breaking the
    // first copy was invisible, because the second quietly put it right. Two
    // copies of a rule is how they come to disagree.
    const has = (v: string | null): v is string => v !== null && v.trim() !== '';
    const mine = (row: { contractor_id: string | null; user_id: string | null }) =>
      row.contractor_id === contractorId ||
      (has(row.user_id) && safe.authProfileIds.includes(row.user_id));

    const wonByMe = new Set<string>();
    const wonByOther = new Set<string>();
    for (const row of signed) {
      if (!has(row.project_id)) continue;
      // Unattributable: neither key set. Never "someone else" — see above.
      if (!has(row.contractor_id) && !has(row.user_id)) continue;
      (mine(row) ? wonByMe : wonByOther).add(row.project_id);
    }

    // A project I have ALSO signed stays mine, whatever else is on it. Two
    // signed proposals from two contractors is a data fault BuildSuite should
    // never produce, and hiding the job from both is not ours to decide.
    return new Set([...wonByOther].filter((id) => !wonByMe.has(id)));
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
