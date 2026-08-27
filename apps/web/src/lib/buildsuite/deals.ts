import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';

/**
 * Reading BuildSuite's `deals` — the matching and proposal engine.
 *
 * The Hub has never read this table. It reads `projects`, which is the far end
 * of the pipeline, so everything upstream of a project has been invisible: who
 * applied, which contractor was matched, whether anything was signed.
 *
 * That invisibility hid the finding this work exists to surface. Measured
 * 2026-08-28 across 182 deals: 47 linked to a project, 5 matched to a
 * contractor, 2 sent to CRM, 1 signature sent, **none signed**. For the Alliance
 * tenant, 23 deals and none matched.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS TABLE ANSWERS that `projects` could not:
 *
 *   1. **How a bid is classified as won.** Open since 2026-08-20 and blocking
 *      the signed-only filter. It is not on `projects`; it is
 *      `signature_signed_at` / `sent_to_crm_at` here.
 *   2. **Where a deal stalls.** `status` carries the lifecycle, so a count per
 *      stage says what is stuck rather than only how much exists.
 * ---------------------------------------------------------------------------
 *
 * Read-only, like the projects reader — the client it uses exposes `select` and
 * `count` and nothing else.
 */

/**
 * The subset of `deals` the Hub reads. Deliberately narrow.
 *
 * **Not selected, on purpose:** `access_token` (a credential), `client_email`
 * and `client_phone` (PII the Hub has no screen for), `photo_urls`,
 * `photo_analysis`, `metadata`, `signed_pdf_url`. The publishable key permits
 * them; the narrowest select is our half of that exposure, and the same
 * discipline `PROJECT_COLUMNS` follows.
 */
export const DEAL_COLUMNS = [
  'id',
  'status',
  'source',
  'created_at',
  'updated_at',
  'auth_profile_id',
  'source_project_id',
  'matched_contractor_id',
  'sent_to_crm_at',
  'signature_status',
  'signature_signed_at',
  'client_name',
  'project_type',
  'budget_range',
  'ghl_contact_id',
  'ghl_opportunity_id',
  'coverage_score',
] as const;

/**
 * Observed 2026-08-28, in lifecycle order. Treated as **open** — this is
 * BuildSuite's vocabulary, not ours, and an unrecognised value must render in
 * its own bucket rather than be dropped or mapped onto a neighbour.
 */
export const DEAL_STAGES = [
  'intake_started',
  'questions_in_progress',
  'intake_complete',
  'draft_ready',
  'contractor_selected',
  'proposal_sent',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number] | (string & {});

export interface BuildSuiteDealRow {
  id: string;
  status: string | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
  auth_profile_id: string | null;
  source_project_id: string | null;
  matched_contractor_id: string | null;
  sent_to_crm_at: string | null;
  signature_status: string | null;
  signature_signed_at: string | null;
  client_name: string | null;
  project_type: string | null;
  budget_range: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
  coverage_score: number | null;
}

/** What the pipeline screen renders. Normalized, nothing internal. */
export interface Deal {
  id: string;
  stage: DealStage;
  source: string;
  clientName: string;
  projectType: string;
  budgetRange: string;
  createdAt: string;
  updatedAt: string;

  // ── The lifecycle facts, as booleans the screen can trust ────────────────
  /** A contractor has been matched. BuildSuite's half of the two-system split. */
  matched: boolean;
  /** The handoff to GoHighLevel has fired. */
  sentToCrm: boolean;
  /** A signature has been captured. **This is "won".** */
  signed: boolean;
  /** Raw signature state — `SENT`, and whatever else BuildSuite uses. */
  signatureStatus: string;

  /** The project this deal became, if it has become one. */
  projectId: string | null;
  /** GHL's contact. Populated on 2 of 182 — the client link is largely missing. */
  ghlContactId: string | null;
  /** Empty on every row measured. Cannot be the join key today (C-3). */
  ghlOpportunityId: string | null;
}

/**
 * Whether this deal represents signed work.
 *
 * **The definition lives in one place, on purpose.** Two columns can each mean
 * won and they do not always arrive together: a signature is captured first,
 * the handoff fires after. Either is enough to say the work was won, and
 * spreading that judgement across screens is how two of them start disagreeing.
 *
 * NEEDS CONFIRMATION from Sing that `signature_signed_at` is the intended
 * column. It is empty on all 182 rows, so no sample can prove it.
 */
export function isSignedWork(deal: Pick<Deal, 'signed' | 'sentToCrm'>): boolean {
  return deal.signed || deal.sentToCrm;
}

function nonEmpty(value: string | null): string {
  return value === null || value.trim() === '' ? '' : value.trim();
}

export function normalizeDeal(row: BuildSuiteDealRow): Deal {
  return {
    id: row.id,
    stage: nonEmpty(row.status) === '' ? 'unknown' : row.status!,
    source: nonEmpty(row.source) || 'unknown',
    clientName: nonEmpty(row.client_name),
    projectType: nonEmpty(row.project_type),
    budgetRange: nonEmpty(row.budget_range),
    createdAt: nonEmpty(row.created_at),
    updatedAt: nonEmpty(row.updated_at) || nonEmpty(row.created_at),

    matched: nonEmpty(row.matched_contractor_id) !== '',
    sentToCrm: nonEmpty(row.sent_to_crm_at) !== '',
    signed: nonEmpty(row.signature_signed_at) !== '',
    signatureStatus: nonEmpty(row.signature_status),

    projectId: nonEmpty(row.source_project_id) === '' ? null : row.source_project_id,
    ghlContactId: nonEmpty(row.ghl_contact_id) === '' ? null : row.ghl_contact_id,
    ghlOpportunityId: nonEmpty(row.ghl_opportunity_id) === '' ? null : row.ghl_opportunity_id,
  };
}

// ── The funnel ──────────────────────────────────────────────────────────────

export interface FunnelStage {
  stage: DealStage;
  count: number;
  /** False for a status BuildSuite has invented since this file was written. */
  known: boolean;
}

export interface DealFunnel {
  total: number;
  /** In lifecycle order, then any unrecognised stages appended. */
  stages: FunnelStage[];
  /** Derived milestones — these cut across stages rather than being one. */
  matched: number;
  sentToCrm: number;
  signed: number;
  linkedToProject: number;
  /**
   * How many of the tenant's deals we could scope at all.
   *
   * `auth_profile_id` is populated on roughly half of `deals`, so a
   * tenant-scoped count **undercounts**. The screen states this rather than
   * presenting the number as complete — a funnel that silently omits half its
   * input is worse than no funnel.
   */
  coverage: { scoped: number; note: string };
}

export function buildFunnel(deals: Deal[], scopedOf: number): DealFunnel {
  const counts = new Map<string, number>();
  for (const deal of deals) counts.set(deal.stage, (counts.get(deal.stage) ?? 0) + 1);

  const stages: FunnelStage[] = DEAL_STAGES.map((stage) => ({
    stage,
    count: counts.get(stage) ?? 0,
    known: true,
  }));

  // Anything BuildSuite has added since. Appended rather than dropped, so a new
  // status shows up as a visible bucket instead of vanishing from the total.
  for (const [stage, count] of counts) {
    if (!(DEAL_STAGES as readonly string[]).includes(stage)) {
      stages.push({ stage, count, known: false });
    }
  }

  return {
    total: deals.length,
    stages,
    matched: deals.filter((d) => d.matched).length,
    sentToCrm: deals.filter((d) => d.sentToCrm).length,
    signed: deals.filter((d) => d.signed).length,
    linkedToProject: deals.filter((d) => d.projectId !== null).length,
    coverage: {
      scoped: scopedOf,
      note:
        'Counts cover deals carrying an auth profile. BuildSuite leaves that column ' +
        'empty on roughly half of all deals, so the real figure may be higher.',
    },
  };
}

/**
 * How long a deal has sat where it is.
 *
 * The count alone hides the actual problem. Sixteen deals at `draft_ready`
 * matters because of how long they have been there, not because there are
 * sixteen. `now` is passed rather than read so this stays pure.
 */
export function daysStalled(deal: Deal, now: Date): number {
  const since = deal.updatedAt === '' ? deal.createdAt : deal.updatedAt;
  if (since === '') return 0;
  const then = Date.parse(since);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

// ── The reader ──────────────────────────────────────────────────────────────

export interface BuildSuiteDealsReader {
  readonly available: true;
  /** Scope is required — there is deliberately no unscoped overload. */
  listDeals(scope: TenantScope, limit?: number): Promise<Deal[]>;
  dealFunnel(scope: TenantScope): Promise<DealFunnel>;
  /** The deals that became a given set of projects. Used to join the two. */
  listDealsForProjects(scope: TenantScope, projectIds: string[]): Promise<Deal[]>;
}

export interface DealsUnavailable {
  readonly available: false;
  readonly missing: string[];
}

/** Exported for tests, which drive it with a fake fetch. Prefer `getDealsReader`. */
export class SupabaseDealsReader implements BuildSuiteDealsReader {
  readonly available = true as const;
  private readonly client: BuildSuiteClient;

  constructor(client: BuildSuiteClient) {
    this.client = client;
  }

  /** Built from the asserted scope, never passed in — same rule as projects. */
  private tenantFilter(scope: TenantScope, context: string): Record<string, string> {
    const safe = assertScope(scope, context);
    return { auth_profile_id: `in.(${safe.authProfileIds.join(',')})` };
  }

  async listDeals(scope: TenantScope, limit = 200): Promise<Deal[]> {
    const rows = await this.client.select<BuildSuiteDealRow>({
      from: 'deals',
      columns: DEAL_COLUMNS,
      filters: this.tenantFilter(scope, 'deals'),
      order: 'updated_at.desc',
      limit,
    });
    return rows.map(normalizeDeal);
  }

  async dealFunnel(scope: TenantScope): Promise<DealFunnel> {
    // One read, counted in memory, rather than a count request per stage. The
    // stage vocabulary is open — a per-stage count would silently miss any
    // status this file has not heard of, which is exactly what must not happen.
    const deals = await this.listDeals(scope, 1000);
    return buildFunnel(deals, deals.length);
  }

  async listDealsForProjects(scope: TenantScope, projectIds: string[]): Promise<Deal[]> {
    if (projectIds.length === 0) return [];

    const rows = await this.client.select<BuildSuiteDealRow>({
      from: 'deals',
      columns: DEAL_COLUMNS,
      filters: {
        ...this.tenantFilter(scope, 'deals for projects'),
        source_project_id: `in.(${projectIds.join(',')})`,
      },
      limit: 500,
    });
    return rows.map(normalizeDeal);
  }
}

let cached: BuildSuiteDealsReader | DealsUnavailable | null = null;

export function getDealsReader(): BuildSuiteDealsReader | DealsUnavailable {
  if (cached !== null) return cached;
  const result = readBuildSuiteConfig();
  cached = result.configured
    ? new SupabaseDealsReader(new BuildSuiteClient(result.config))
    : { available: false, missing: result.missing };
  return cached;
}

/** Test seam — the module-level cache must not leak between tests. */
export function resetDealsReader(): void {
  cached = null;
}
