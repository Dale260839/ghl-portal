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
  // The join key (C-3). Populated on 49 of 102 — a project without one
  // cannot hand off and cannot be used as a homeowner's second factor.
  'project_code',
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
  // Selected as well as filtered on: `Project.ownerAuthProfileId` carries it,
  // and a row that cannot say who owns it cannot be re-checked downstream.
  'auth_profile_id',
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
  project_code: string | null;
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
  auth_profile_id: string | null;
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

  /**
   * Every project for the tenant, whatever its status — the raw rows.
   *
   * `listActiveProjects` narrows to `status=active` and normalizes for the
   * "Incoming from BuildSuite" screen. This one backs the main data source,
   * which needs draft and completed work too and does its own mapping.
   */
  listProjectRows(scope: TenantScope, limit?: number): Promise<BuildSuiteProjectRow[]>;

  /**
   * The projects belonging to one GHL contact (§1.4 — a contact may hold
   * several; two of this tenant's five do).
   *
   * Deliberately not tenant-scoped: a homeowner's jobs can sit with any
   * contractor, and the §9.1 gate is what constrains this read.
   */
  listProjectRowsForContact(ghlContactId: string, limit?: number): Promise<BuildSuiteProjectRow[]>;
  listProjectRowsByIds(projectIds: string[], limit?: number): Promise<BuildSuiteProjectRow[]>;
  findProjectForClientLogin(
    projectCode: string,
    clientEmail: string,
  ): Promise<{ id: string; ghlContactId: string } | null>;
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

  async listProjectRows(scope: TenantScope, limit = 200): Promise<BuildSuiteProjectRow[]> {
    return await this.client.select<BuildSuiteProjectRow>({
      from: 'projects',
      columns: PROJECT_COLUMNS,
      filters: this.tenantFilter(scope, 'project rows'),
      order: 'updated_at.desc',
      limit,
    });
  }

  async listProjectRowsForContact(
    ghlContactId: string,
    limit = 50,
  ): Promise<BuildSuiteProjectRow[]> {
    const id = ghlContactId.trim();
    // An empty contact id would drop the filter and return the whole table.
    if (id === '') return [];

    return await this.client.select<BuildSuiteProjectRow>({
      from: 'projects',
      columns: PROJECT_COLUMNS,
      filters: { ghl_contact_id: `eq.${id}` },
      order: 'updated_at.desc',
      limit,
    });
  }

  /**
   * Specific projects, by BuildSuite id.
   *
   * Not tenant-scoped, and constrained instead by the id list — which is only
   * ever written by a contractor, against their own projects, on the Team
   * screen. That makes it safe for a homeowner read: an invited client holds no
   * auth profile, so there is no scope to read with, and this returns exactly
   * what they were given and nothing else.
   *
   * An empty list returns empty rather than dropping the filter. That is the
   * whole safety property, so it is asserted in a test.
   */
  async listProjectRowsByIds(projectIds: string[], limit = 50): Promise<BuildSuiteProjectRow[]> {
    const ids = [...new Set(projectIds.map((id) => id.trim()).filter((id) => id !== ''))];
    if (ids.length === 0) return [];

    return await this.client.select<BuildSuiteProjectRow>({
      from: 'projects',
      columns: PROJECT_COLUMNS,
      filters: { id: `in.(${ids.join(',')})` },
      order: 'updated_at.desc',
      limit,
    });
  }

  /**
   * The homeowner login lookup (C-2): does a project exist with THIS code and
   * THIS client email?
   *
   * ---------------------------------------------------------------------------
   * BOTH HALVES ARE FILTERED SERVER-SIDE, AND `client_email` IS NEVER SELECTED.
   *
   * `PROJECT_COLUMNS` deliberately omits `client_email` (D-010 minimisation).
   * The obvious way to add a login would be to start selecting it, which would
   * reverse that decision for every screen in the app.
   *
   * Instead the address is used as a FILTER and never as a column: PostgREST
   * compares it inside the database and returns only an id and a contact id. A
   * wrong email returns zero rows, and no client address is ever transferred to
   * this process at all — including for the matching row.
   *
   * Not tenant-scoped, deliberately: a homeowner is not a tenant and has no
   * scope to read with. It is constrained by needing both halves, and it mints
   * nothing — see `client-lookup.ts`.
   * ---------------------------------------------------------------------------
   */
  async findProjectForClientLogin(
    projectCode: string,
    clientEmail: string,
  ): Promise<{ id: string; ghlContactId: string } | null> {
    const code = projectCode.trim().toUpperCase();
    const email = clientEmail.trim().toLowerCase();

    // Validated, not escaped. Anything that is not a well-formed code or a
    // plausible address never reaches the query — which fails closed and
    // removes the question of PostgREST filter injection rather than answering
    // it. A `,` or `)` in a filter value would otherwise change its meaning.
    if (!/^BSA-\d{3}$/.test(code)) return null;
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;

    const rows = await this.client.select<{ id: string; ghl_contact_id: string | null }>({
      from: 'projects',
      columns: ['id', 'ghl_contact_id'],
      filters: { project_code: `eq.${code}`, client_email: `eq.${email}` },
      limit: 2,
    });

    // Exactly one, or nothing. Two projects sharing a code is a data fault, and
    // picking one of them would sign somebody into a job that may not be theirs.
    if (rows.length !== 1) return null;
    return { id: rows[0]!.id, ghlContactId: rows[0]!.ghl_contact_id ?? '' };
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
