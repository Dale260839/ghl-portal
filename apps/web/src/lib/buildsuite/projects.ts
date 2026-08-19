import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';

/**
 * Reading BuildSuite's live projects.
 *
 * Column names below were read from the live schema on 2026-08-06, not guessed —
 * `projects` has 53 columns and these are the ones the Hub needs. Two facts from
 * that schema shape everything here:
 *
 *   1. **There is no BuildSuite Project ID** (D-010). No `bsp_*` column, no
 *      `BSP-` value anywhere. What every row carries is `ghl_contact_id` and
 *      `ghl_opportunity_id` — BuildSuite already links to GHL with GHL's own
 *      identifiers, so those are the join keys, pending Chris's sign-off on
 *      amending §5.
 *   2. **BuildSuite's status vocabulary is its own** — `active`, `matched`,
 *      `new`, `draft`, `completed` — and is NOT the §7 19-stage pipeline. Do not
 *      map one onto the other without an agreed table; it is lossy both ways.
 */

/** The subset of `projects` the Hub reads. Deliberately narrow (see SelectOptions). */
export const PROJECT_COLUMNS = [
  'id',
  'title',
  'status',
  'source',
  'created_at',
  'updated_at',
  'street_address',
  'city',
  'state',
  'postal_code',
  'trade',
  'project_type',
  'budget_band',
  'exact_budget',
  'start_date',
  'end_date',
  'client_name',
  'ghl_contact_id',
  'ghl_opportunity_id',
] as const;

/**
 * `client_email`, `client_phone`, `scope`, `sow_data`, and `documents` are
 * deliberately NOT selected. The read key permits them (D-010) but the Hub has
 * no screen that needs them, and the narrowest select is our half of that
 * finding.
 */

/** Observed values, 2026-08-06. Treated as open — this is BuildSuite's vocabulary. */
export type BuildSuiteStatus = 'active' | 'matched' | 'new' | 'draft' | 'completed' | (string & {});

export interface BuildSuiteProjectRow {
  id: string;
  title: string | null;
  status: BuildSuiteStatus | null;
  source: string | null;
  created_at: string | null;
  updated_at: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  trade: string | null;
  project_type: string | null;
  budget_band: string | null;
  exact_budget: number | null;
  start_date: string | null;
  end_date: string | null;
  client_name: string | null;
  ghl_contact_id: string | null;
  ghl_opportunity_id: string | null;
}

/** What the Hub actually renders. Normalized, nothing internal. */
export interface BuildSuiteProject {
  id: string;
  title: string;
  status: string;
  source: string;
  address: string;
  trade: string;
  projectType: string;
  budget: string;
  clientName: string;
  updatedAt: string | null;
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  /** True when BuildSuite has linked this project into GHL already. */
  linkedToGhl: boolean;
}

function joinAddress(row: BuildSuiteProjectRow): string {
  return [row.street_address, row.city, row.state, row.postal_code]
    .filter((part) => part !== null && part.trim() !== '')
    .join(', ');
}

function budgetOf(row: BuildSuiteProjectRow): string {
  if (row.exact_budget !== null && Number.isFinite(row.exact_budget)) {
    return row.exact_budget.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
  }
  return row.budget_band ?? '—';
}

export function normalizeProject(row: BuildSuiteProjectRow): BuildSuiteProject {
  return {
    id: row.id,
    title: row.title ?? 'Untitled project',
    status: row.status ?? 'unknown',
    source: row.source ?? 'unknown',
    address: joinAddress(row),
    trade: row.trade ?? '—',
    projectType: row.project_type ?? '—',
    budget: budgetOf(row),
    clientName: row.client_name ?? '—',
    updatedAt: row.updated_at ?? row.created_at,
    ghlContactId: row.ghl_contact_id,
    ghlOpportunityId: row.ghl_opportunity_id,
    // §3.6's requirement — an immutable cross-system key — is satisfied by
    // ghl_opportunity_id where it exists. Where it doesn't, the project has no
    // GHL counterpart yet and nothing downstream can join to it.
    linkedToGhl: row.ghl_opportunity_id !== null && row.ghl_opportunity_id !== '',
  };
}

export interface BuildSuiteReader {
  readonly available: true;
  /** Scope is required — there is deliberately no unscoped overload. */
  listActiveProjects(scope: TenantScope, limit?: number): Promise<BuildSuiteProject[]>;
  countByStatus(scope: TenantScope): Promise<Record<string, number>>;
  /**
   * Every BuildSuite profile belonging to a GHL sub-account (D-011, D-015).
   *
   * This is the tenant lookup, and it runs *before* a scope exists — at the
   * moment of establishing one. That makes it the only read in the system that
   * can look across tenants, so it returns ids and nothing else: no names, no
   * emails, no rows a caller could harvest.
   *
   * Returns several because an agency legitimately has several. The live
   * location `IifYfP2B2NUaoDPdsTTa` has two admin profiles owning nine projects
   * between them; scoping to one would hide half an agency's work from itself.
   */
  listAuthProfileIdsForLocation(locationId: string): Promise<string[]>;
}

export interface BuildSuiteUnavailable {
  readonly available: false;
  readonly missing: string[];
}

class SupabaseReader implements BuildSuiteReader {
  readonly available = true as const;
  private readonly client: BuildSuiteClient;

  constructor(client: BuildSuiteClient) {
    this.client = client;
  }

  /**
   * The tenant filter is built here, from the asserted scope — never passed in
   * by a caller. A caller that could supply its own filter could supply none.
   */
  private tenantFilter(scope: TenantScope, context: string): Record<string, string> {
    const safe = assertScope(scope, context);
    // PostgREST `in` takes a parenthesised list. assertScope has already
    // guaranteed the list is non-empty — an empty `in ()` would match nothing
    // silently, which reads as "this agency has no projects".
    return { auth_profile_id: `in.(${safe.authProfileIds.join(',')})` };
  }

  async listActiveProjects(scope: TenantScope, limit = 50): Promise<BuildSuiteProject[]> {
    const rows = await this.client.select<BuildSuiteProjectRow>({
      from: 'projects',
      columns: PROJECT_COLUMNS,
      filters: { ...this.tenantFilter(scope, 'active projects'), status: 'eq.active' },
      order: 'updated_at.desc',
      limit,
    });
    return rows.map(normalizeProject);
  }

  async listAuthProfileIdsForLocation(locationId: string): Promise<string[]> {
    const id = locationId.trim();
    if (id === '') return [];

    const rows = await this.client.select<{ id: string }>({
      from: 'auth_profiles',
      // Only the id. This read crosses tenants by necessity, so it returns the
      // minimum that establishes one and nothing that could be harvested.
      columns: ['id'],
      filters: { location_id: `eq.${id}` },
      limit: 50,
    });

    return rows.map((r) => r.id).filter((v) => typeof v === 'string' && v !== '');
  }

  async countByStatus(scope: TenantScope): Promise<Record<string, number>> {
    const tenant = this.tenantFilter(scope, 'project counts');
    // One count request per status rather than pulling every row to tally
    // client-side. Cheap, and it never transfers project data.
    const statuses = ['active', 'matched', 'new', 'draft', 'completed'] as const;
    const counts = await Promise.all(
      statuses.map(async (status) => [
        status,
        await this.client.count('projects', { ...tenant, status: `eq.${status}` }),
      ] as const),
    );
    return Object.fromEntries(counts);
  }
}

let cached: BuildSuiteReader | BuildSuiteUnavailable | null = null;

export function getBuildSuiteReader(): BuildSuiteReader | BuildSuiteUnavailable {
  if (cached !== null) return cached;
  const result = readBuildSuiteConfig();
  cached = result.configured
    ? new SupabaseReader(new BuildSuiteClient(result.config))
    : { available: false, missing: result.missing };
  return cached;
}
