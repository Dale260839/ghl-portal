import { normalizeProjectCode, PROJECT_CODE_PATTERN } from '@buildsuite/contracts';

import { BuildSuiteClient, readBuildSuiteConfig } from './client.ts';
import { resolveContractor } from './contractor-identity.ts';
import { UNKNOWN_LOCATION } from '../tenant-scope.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';

/**
 * `proposals.signature_status` when a contract has actually been signed.
 *
 * Verbatim from the live column — 6 of 48 rows carry it and the other 42 are
 * null. A literal at each call site is how the value and the comparison drift
 * apart.
 */
export const SIGNED_SIGNATURE_STATUS = 'SIGNED';

/**
 * Normalise and validate the two halves a homeowner types, or refuse.
 *
 * Validated, NOT escaped. Anything that is not a well-formed code or a
 * plausible address never reaches the query, which fails closed and removes the
 * question of PostgREST filter injection rather than answering it — a `,` or a
 * `)` inside a filter value would otherwise change what the filter means.
 *
 * One copy for both doors. The code pattern comes from `@buildsuite/contracts`
 * rather than being written out again here: this file used to hold its own copy
 * of it, and a three-digits-only version rejected every contractor-created
 * project (`BSA-ASJF-006`), whose homeowner could then never sign in at all.
 */
function clientLoginPair(
  projectCode: string,
  clientEmail: string,
): { code: string; email: string } | null {
  // Normalised by the contract, not here. It handles the ways a code arrives
  // from a human — lower case, stray spaces, a dictated "BSA 052", a dropped
  // leading zero — and it is the same function the numbering convention is
  // tested against, so the door and the contract cannot disagree.
  const code = normalizeProjectCode(projectCode);
  const email = clientEmail.trim().toLowerCase();
  if (!PROJECT_CODE_PATTERN.test(code)) return null;
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) return null;
  return { code, email };
}

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
  // The signed scope-of-work PDF and the written description. Read for the
  // field crew's Docs screen (Chris, 11 Sep: the crew need the scope). Still not
  // selected: client_email except for the one invoice read, client_phone,
  // sow_data, documents.
  'sow_pdf_url',
  'project_description',
  // Selected as well as filtered on: `Project.ownerAuthProfileId` carries it,
  // and a row that cannot say who owns it cannot be re-checked downstream.
  'auth_profile_id',
  // ── The award, as BuildSuite records it (Sing, 2026-09-12) ─────────────────
  //
  // When a project is awarded, THE SAME ROW gets these written onto it —
  // status 'awarded', award_code, awarded_to_auth_profile_id and
  // awarded_contractor_id. It keeps its id, its project_code and its client
  // ownership. No copy, no second row, no transfer.
  //
  //   project_code  the client's code and the project's permanent identity
  //   award_code    the WINNING contractor's code; empty on a project the
  //                 contractor created themselves, where project_code already is
  //   awarded_to_auth_profile_id / awarded_contractor_id  who won it
  //
  // Measured 2026-09-12: awarded_to set on the 4 awarded rows, award_code on 1
  // (BSA-053 -> BSA-APS-003). No award_code collides with any project_code.
  'award_code',
  'awarded_to_auth_profile_id',
  'awarded_contractor_id',
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
  sow_pdf_url?: string | null;
  project_description?: string | null;
  auth_profile_id: string | null;
  /** The winning contractor's code. Null on a self-created project. */
  award_code?: string | null;
  /** Who won it — the auth profile. Set on every awarded project. */
  awarded_to_auth_profile_id?: string | null;
  /** Who won it — the contractor record. */
  awarded_contractor_id?: string | null;
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

  /**
   * The homeowner's email on ONE of this tenant's projects, for the invoice
   * recipient. `client_email` is kept out of `PROJECT_COLUMNS` on purpose
   * (D-010): this is the single read that needs it, it is filtered on the
   * owner like every other project read, and the value goes to the rail,
   * never to a client screen. Null when the row has none.
   */
  clientEmailForProject(scope: TenantScope, projectId: string): Promise<string | null>;


  /**
   * The same match, but it also proves the contract is SIGNED and says whose.
   *
   * -------------------------------------------------------------------------
   * WHY THIS IS A SECOND METHOD AND NOT A FLAG ON THE FIRST
   *
   * `findProjectForClientLogin` backs the emailed-link door, which mints
   * nothing. This one backs the door where the project code IS the password
   * (Chris, 2026-09-10), so it mints a session directly, and the two must not
   * share a signature that a caller could get the wrong way round.
   *
   * The signature requirement is the load-bearing half. A code alone is about
   * six bits — `BSA-001` through `BSA-052`, sequential — so what stops it being
   * a guessing game is that only 6 of 48 proposals are signed, and an unsigned
   * project's code opens nothing at all. Attempt limiting sits in front of it
   * as well (`lib/auth/rate-limit.ts`), keyed on the email and the caller, never
   * on the code.
   *
   * `contractorId` comes off the PROPOSAL, which is where BuildSuite's tenancy
   * for that table actually lives — not resolved from the project's auth
   * profile, which would be a second guess at an answer the row already holds.
   * -------------------------------------------------------------------------
   */
  findSignedProjectForClient(
    projectCode: string,
    clientEmail: string,
  ): Promise<SignedProjectForClient | null>;
}

/** What the code-as-password door needs to open a session, and nothing more. */
export interface SignedProjectForClient {
  projectId: string;
  /** `contractors.id`, read from the signed proposal. Files the membership. */
  contractorId: string;
  ghlContactId: string;
  /** For the greeting and the contractor's Team screen. Never an email. */
  clientName: string;

}

export interface BuildSuiteUnavailable {
  readonly available: false;
  readonly missing: string[];
}

/** How the reader reaches a contractor when a proposal names none. Injectable. */
export type ContractorLookup = (scope: TenantScope) => Promise<
  { resolved: true; identity: { contractorId: string } } | { resolved: false; reason: string }
>;

export class SupabaseReader implements BuildSuiteReader {
  readonly available = true as const;
  private readonly client: BuildSuiteClient;
  private readonly lookupContractor: ContractorLookup;

  /**
   * `lookupContractor` defaults to the real resolver and is a parameter only so
   * the sign-in path can be tested without a network. Exported for the same
   * reason: this class decides who gets into a homeowner's portal, and that
   * decision should be exercised directly rather than through `getBuildSuiteReader`,
   * which builds its own client from environment variables.
   */
  constructor(client: BuildSuiteClient, lookupContractor: ContractorLookup = resolveContractor) {
    this.client = client;
    this.lookupContractor = lookupContractor;
  }

  /**
   * The tenant filter is built here, from the asserted scope — never passed in
   * by a caller. A caller that could supply its own filter could supply none.
   */
  /**
   * Which projects are this contractor's: the ones they WON, else the ones they own.
   *
   * ---------------------------------------------------------------------------
   * THE RULE (Sing, 2026-09-12)
   *
   * `awarded_to_auth_profile_id` says who won a project. When it is set, it
   * decides — `auth_profile_id` is the project's CLIENT ownership, and it stays
   * on the row unchanged when the project is awarded. When nobody has been
   * awarded it, the owner decides, exactly as before.
   *
   * So the operating contractor is `COALESCE(awarded_to_auth_profile_id,
   * auth_profile_id)`, and this filter is that, in PostgREST:
   *
   *   awarded_to in (mine)   OR   (awarded_to is null AND auth_profile_id in (mine))
   *
   * It also enforces Chris's rule from the 2026-09-10 huddle — "only the
   * awarded contractor should retain access while others are blocked": a
   * project whose owner is one contractor and whose award went to another is
   * listed for the WINNER only. No live row is in that state today; every
   * awarded row has its winner as its owner or no owner at all.
   *
   * ---------------------------------------------------------------------------
   * WHAT THIS REPLACED
   *
   * BSA-053 has no `auth_profile_id`, so it reached no listing. That was first
   * fixed by inferring the owner from whoever wrote its signed proposal
   * (`proposals.user_id`) and adopting the row — a workaround for a link that
   * turns out to exist. `awarded_to_auth_profile_id` IS that link, written by
   * BuildSuite on award. Two rules deciding who owns a project is how they come
   * to disagree, so the inference is gone and this is the only rule.
   * ---------------------------------------------------------------------------
   */
  private tenantFilter(scope: TenantScope, context: string): Record<string, string> {
    const safe = assertScope(scope, context);
    // PostgREST `in` takes a parenthesised list. assertScope has already
    // guaranteed the list is non-empty — an empty `in ()` would match nothing
    // silently, which reads as "this agency has no projects".
    const mine = `(${safe.authProfileIds.join(',')})`;
    return {
      or: `(awarded_to_auth_profile_id.in.${mine},and(awarded_to_auth_profile_id.is.null,auth_profile_id.in.${mine}))`,
    };
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
    // One read. The award columns make a project its winner's, so BSA-053 —
    // no `auth_profile_id`, awarded to Alliance Pro Services — is listed for
    // APS by the tenant filter itself, with no second pass to find it.
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
  async clientEmailForProject(scope: TenantScope, projectId: string): Promise<string | null> {
    if (projectId.trim() === '') return null;
    const rows = await this.client.select<{ client_email: string | null }>({
      from: 'projects',
      columns: ['client_email'],
      filters: {
        ...this.tenantFilter(scope, 'client email'),
        id: `eq.${projectId}`,
        deleted_at: 'is.null',
      },
      limit: 1,
    });
    const email = (rows[0]?.client_email ?? '').trim().toLowerCase();
    return email === '' ? null : email;
  }

  async findProjectForClientLogin(
    projectCode: string,
    clientEmail: string,
  ): Promise<{ id: string; ghlContactId: string } | null> {
    const pair = clientLoginPair(projectCode, clientEmail);
    if (pair === null) return null;

    const rows = await this.client.select<{ id: string; ghl_contact_id: string | null }>({
      from: 'projects',
      columns: ['id', 'ghl_contact_id'],
      filters: { project_code: `eq.${pair.code}`, client_email: `eq.${pair.email}` },
      limit: 2,
    });

    // Exactly one, or nothing. Two projects sharing a code is a data fault, and
    // picking one of them would sign somebody into a job that may not be theirs.
    if (rows.length !== 1) return null;
    return { id: rows[0]!.id, ghlContactId: rows[0]!.ghl_contact_id ?? '' };
  }

  async findSignedProjectForClient(
    projectCode: string,
    clientEmail: string,
  ): Promise<SignedProjectForClient | null> {
    const pair = clientLoginPair(projectCode, clientEmail);
    if (pair === null) return null;

    // Both halves inside the query, and `client_email` is never selected — the
    // address the visitor typed is compared in the database and no client
    // address comes back out of it (D-010).
    const rows = await this.client.select<{
      id: string;
      ghl_contact_id: string | null;
      client_name: string | null;
      auth_profile_id: string | null;
      awarded_to_auth_profile_id: string | null;
      awarded_contractor_id: string | null;
    }>({
      from: 'projects',
      columns: [
        'id',
        'ghl_contact_id',
        'client_name',
        'auth_profile_id',
        'awarded_to_auth_profile_id',
        'awarded_contractor_id',
      ],
      filters: { project_code: `eq.${pair.code}`, client_email: `eq.${pair.email}` },
      limit: 2,
    });
    if (rows.length !== 1) return null;
    const project = rows[0]!;

    // THE SIGNATURE GATE. Not decoration: it is what makes a six-bit code
    // survivable, and it is the rule as stated — "all the signed project should
    // have that". A project whose contract is unsigned admits nobody, whatever
    // code is typed at it.
    //
    // `signature_status` is the explicit state column; `signature_signed_at` is
    // the timestamp behind it. Both are required, so a half-written row — a
    // status set by an automation that never recorded a time, or the reverse —
    // does not open a portal.
    const signed = await this.client.select<{ contractor_id: string | null }>({
      from: 'proposals',
      columns: ['contractor_id'],
      filters: {
        project_id: `eq.${project.id}`,
        signature_status: `eq.${SIGNED_SIGNATURE_STATUS}`,
        signature_signed_at: 'not.is.null',
        deleted_at: 'is.null',
      },
      order: 'signature_signed_at.desc',
      limit: 1,
    });

    // No signed proposal at all. Nobody gets in, whatever code was typed.
    if (signed.length === 0) return null;

    // WHOSE HOMEOWNER THIS IS — the winning contractor, by the first link that
    // names one:
    //
    //   1. `projects.awarded_contractor_id` — BuildSuite's own record of who won
    //      it, written onto the row at award (Sing, 2026-09-12). The designed
    //      answer, so it comes first.
    //   2. `proposals.contractor_id` on the signed proposal.
    //   3. The contractor behind the project's operating profile — the award's
    //      `awarded_to_auth_profile_id`, else the owner.
    //
    // BSA-053 needed the first. Its proposal carries no contractor_id and the
    // row has no owner, so links 2 and 3 found nothing and its homeowner could
    // not sign in with a correct code on a signed contract.
    const contractorId =
      (project.awarded_contractor_id ?? '').trim() ||
      (signed[0]?.contractor_id ?? '').trim() ||
      (await this.contractorOfProject(
        project.awarded_to_auth_profile_id ?? project.auth_profile_id,
      ));

    // A signed contract that names no contractor by ANY of the links. The
    // membership this opens is filed under a contractor id, and filing it under
    // an empty string would put a homeowner in a tenant that does not exist.
    if (contractorId === '') return null;

    return {
      projectId: project.id,
      contractorId,
      ghlContactId: project.ghl_contact_id ?? '',
      clientName: (project.client_name ?? '').trim(),
    };
  }

  /**
   * The contractor behind a project, when the proposal did not name one.
   *
   * `proposals.contractor_id` is null on 13 of 48 rows, and on one of the six
   * SIGNED ones — `BSA-APS-001`, whose homeowner could otherwise never sign in
   * even though their contract is signed and their code is correct. Found on
   * 2026-09-10 by running the real reader against live data rather than by
   * reading the schema.
   *
   * This delegates to `ContractorResolver` instead of walking the links again
   * here. That resolver is the ONE place that knows how a BuildSuite profile
   * maps to a contractor — dedicated id fields only, ambiguity resolving to
   * nothing rather than to a coin flip (§3.6, D4 §6) — and a second copy of
   * that chain is a second thing to keep in step with it.
   *
   * `UNKNOWN_LOCATION` because there is no session here to take a location
   * from, and the resolver never filters on one: it reads the profile by id.
   * The same placeholder `scopeOfProject` uses, for the same reason.
   */
  private async contractorOfProject(authProfileId: string | null): Promise<string> {
    const profileId = (authProfileId ?? '').trim();
    if (profileId === '') return '';

    const identity = await this.lookupContractor({
      locationId: UNKNOWN_LOCATION,
      authProfileIds: [profileId],
    });
    return identity.resolved ? identity.identity.contractorId : '';
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
