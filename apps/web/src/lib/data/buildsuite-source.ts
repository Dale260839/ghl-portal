import { cache } from 'react';
import type { BuildSuiteProjectRow, BuildSuiteReader } from '../buildsuite/projects.ts';
import { createTtlCache, type TtlCache } from '../ttl-cache.ts';
import { assertScope, ownedByScope, type TenantScope } from '../tenancy.ts';
import type { Contact, DailyUpdate, Issue, Milestone, Project, Task } from './types.ts';
import { applyVisibility, type VisibilityOverlaySource } from './visibility-overlay.ts';
import type { ProjectDataSource } from './source.ts';

/**
 * Real projects, read from BuildSuite's Supabase.
 *
 * ---------------------------------------------------------------------------
 * WHAT BUILDSUITE ACTUALLY HAS, measured against the live Alliance tenant on
 * 2026-08-20 (nine projects, two auth profiles):
 *
 *   populated on every row  id · title · status · source · created/updated
 *                           city · state · postal_code · budget_band
 *                           start_date · end_date · auth_profile_id
 *   mostly populated        client_name (8/9) · ghl_contact_id (7/9)
 *   never populated         street_address · trade · project_type
 *                           exact_budget · ghl_opportunity_id
 *
 * Two of those absences decide the shape of this file:
 *
 *   **`exact_budget` is empty on every row.** BuildSuite records a *band* —
 *   "$50,000 - $100,000" — and a band is not a number. Parsing a midpoint out
 *   of it would put a fabricated figure on a contractor's dashboard, so the
 *   money fields stay at zero and `budgetBand` carries the real string. Screens
 *   check `hasFinancials()` and show nothing rather than a confident $0.
 *
 *   **`ghl_opportunity_id` is empty on every row.** So it cannot be the join
 *   key yet, whatever D-010 settles on; `buildsuiteProjectId` is BuildSuite's
 *   own `id`.
 *
 * BuildSuite also has no daily updates, milestones, tasks or issues at all —
 * those are the `hub_*` tables, which are written and not yet created. Those
 * reads return empty here. Empty is a true statement about a system that has no
 * such records; falling back to fixtures would put invented work on a screen
 * beside real projects, which is the one thing that must not happen.
 * ---------------------------------------------------------------------------
 */
/**
 * One project-rows read per tenant per request.
 *
 * Every layout and page on a contractor route reads projects, and `getProject`
 * is itself a list-then-find, so a single navigation was issuing this 200-row
 * query two or three times. The client also mints a fresh `AbortSignal` per
 * call, which is enough to defeat Next's automatic fetch memoization. React's
 * `cache()` collapses the calls for the life of the request. Keyed on the reader
 * (a per-process singleton) and the scope object, which `requireTenantScope`
 * now hands out once per request, so the key is stable.
 *
 * Beneath that, the rows are held per tenant for thirty seconds across
 * requests. Projects are created and edited in BuildSuite, not here, so the Hub
 * is already reading a snapshot; thirty seconds of it costs nothing visible and
 * saves the one wide query every click was paying for. Keyed on the sorted
 * profile ids, which is exactly the tenant filter the query applies (D-013).
 *
 * The TTL store hangs off the *reader*, not the module. In production there is
 * one reader, so that is the same thing; in tests every case builds its own
 * fake reader with its own rows, and a module-level store keyed only by tenant
 * served the first case's rows to the rest. Scoping the store to the reader
 * isolates them without a single test knowing the cache exists.
 */
const rowsTtlByReader = new WeakMap<BuildSuiteReader, TtlCache<BuildSuiteProjectRow[]>>();

function rowsTtlFor(reader: BuildSuiteReader): TtlCache<BuildSuiteProjectRow[]> {
  let store = rowsTtlByReader.get(reader);
  if (store === undefined) {
    store = createTtlCache<BuildSuiteProjectRow[]>(30_000);
    rowsTtlByReader.set(reader, store);
  }
  return store;
}

const rowsForScope: (
  reader: BuildSuiteReader,
  safe: TenantScope,
) => Promise<BuildSuiteProjectRow[]> = cache(async (reader, safe) =>
  rowsTtlFor(reader).get([...safe.authProfileIds].sort().join(','), () =>
    reader.listProjectRows(safe),
  ),
);

/**
 * The homeowner's reads, memoized the same way.
 *
 * A client navigation read the contact's projects in the portal layout and then
 * again in the page through a different function, and neither was covered by
 * the cache above — so every client click paid one to three uncached
 * round-trips, which is the slowness reported on 8 Sep. These share one read
 * per request and hold it for thirty seconds per reader. The keys are the
 * read's own keys (the GoHighLevel contact id, or the ticked project ids), which
 * is exactly what constrains those reads (§9.1); nothing here widens them.
 */
const contactRowsFor: (
  reader: BuildSuiteReader,
  contactId: string,
) => Promise<BuildSuiteProjectRow[]> = cache(async (reader, contactId) =>
  rowsTtlFor(reader).get(`contact:${contactId}`, () =>
    reader.listProjectRowsForContact(contactId),
  ),
);

const idsRowsFor: (
  reader: BuildSuiteReader,
  idsKey: string,
) => Promise<BuildSuiteProjectRow[]> = cache(async (reader, idsKey) =>
  rowsTtlFor(reader).get(`ids:${idsKey}`, () =>
    reader.listProjectRowsByIds(idsKey === '' ? [] : idsKey.split(',')),
  ),
);

export class BuildSuiteDataSource implements ProjectDataSource {
  readonly kind = 'buildsuite' as const;

  private readonly reader: BuildSuiteReader;
  private readonly locationId: string;
  /**
   * The Hub's stored visibility switches, laid over every project this source
   * serves (§6.1). Optional: without it — tests, or a deployment with no Hub
   * connection — every switch stays off, which is the safe default.
   */
  private readonly visibility: VisibilityOverlaySource | undefined;

  constructor(reader: BuildSuiteReader, locationId: string, visibility?: VisibilityOverlaySource) {
    this.reader = reader;
    this.locationId = locationId;
    this.visibility = visibility;
  }

  private async withVisibility(projects: Project[]): Promise<Project[]> {
    if (this.visibility === undefined || projects.length === 0) return projects;
    const byId = await this.visibility.visibilityFor(projects.map((p) => p.buildsuiteProjectId));
    return applyVisibility(projects, byId);
  }

  async listProjects(scope: TenantScope): Promise<Project[]> {
    const safe = assertScope(scope, 'projects');
    const rows = await rowsForScope(this.reader, safe);
    return this.withVisibility(rows.map((row) => this.toProject(row)));
  }

  async getProject(scope: TenantScope, buildsuiteProjectId: string): Promise<Project | null> {
    // Fetch the tenant's rows and match within them, rather than fetching by id
    // and checking ownership afterwards. A found-then-rejected lookup is one
    // refactor away from becoming found-then-returned.
    const projects = await this.listProjects(scope);
    return projects.find((p) => p.buildsuiteProjectId === buildsuiteProjectId) ?? null;
  }

  /**
   * §1.4 — a contact may hold several projects, and two of this tenant's five
   * contacts do. Not tenant-scoped: a homeowner's jobs can sit with any
   * contractor, and the §9.1 gate is what constrains this read.
   */
  async listProjectsForContact(contactId: string): Promise<Project[]> {
    const rows = await contactRowsFor(this.reader, contactId);
    return this.withVisibility(rows.map((row) => this.toProject(row)));
  }

  /** The invited-client read: exactly the projects they were assigned. */
  async listProjectsByIds(projectIds: string[]): Promise<Project[]> {
    const key = [...new Set(projectIds.map((id) => id.trim()).filter((id) => id !== ''))]
      .sort()
      .join(',');
    const rows = await idsRowsFor(this.reader, key);
    return this.withVisibility(rows.map((row) => this.toProject(row)));
  }

  /**
   * Assembled from the projects the contact owns, because BuildSuite's
   * `contacts` are GHL's and we hold no separate record. Returns null rather
   * than an empty shell when the contact owns nothing we can see.
   */
  async getContact(contactId: string): Promise<Contact | null> {
    const rows = await contactRowsFor(this.reader, contactId);
    if (rows.length === 0) return null;

    const named = rows.find((r) => r.client_name !== null && r.client_name.trim() !== '');
    return {
      id: contactId,
      name: named?.client_name?.trim() ?? 'Client',
      // BuildSuite holds client_email and client_phone; we deliberately do
      // not select them (see PROJECT_COLUMNS), so there is nothing to carry.
      email: '',
      projectIds: rows.map((r) => r.id),
    };
  }

  // ── Records BuildSuite does not hold ──────────────────────────────────────
  // The `hub_*` tables carry these and do not exist yet. Scope is still asserted
  // so that turning these on later cannot accidentally skip the tenant check.

  async listMilestones(scope: TenantScope, _buildsuiteProjectId: string): Promise<Milestone[]> {
    assertScope(scope, 'milestones');
    return [];
  }

  async listTasks(scope: TenantScope, _buildsuiteProjectId?: string): Promise<Task[]> {
    assertScope(scope, 'tasks');
    return [];
  }

  async listDailyUpdates(scope: TenantScope, _buildsuiteProjectId?: string): Promise<DailyUpdate[]> {
    assertScope(scope, 'daily updates');
    return [];
  }

  async listIssues(scope: TenantScope, _buildsuiteProjectId?: string): Promise<Issue[]> {
    assertScope(scope, 'issues');
    return [];
  }

  // ── Mapping ───────────────────────────────────────────────────────────────

  /**
   * One BuildSuite row to one `Project`.
   *
   * Real values where BuildSuite has them. Zero, empty and `false` where it does
   * not — never a plausible-looking guess. The visibility switches are all off,
   * which is the only safe default: nobody has decided to publish these to a
   * homeowner, and a switch defaulting to on would publish them by omission.
   */
  private toProject(row: BuildSuiteProjectRow): Project {
    const status = row.status ?? 'unknown';

    return {
      provenance: 'buildsuite',

      // Tenancy
      ownerAuthProfileId: row.auth_profile_id ?? '',
      ghlLocationId: this.locationId,

      // Identity
      buildsuiteProjectId: row.id,
      projectCode: nonEmpty(row.project_code) ?? null,
      projectName: row.title?.trim() !== '' ? (row.title ?? 'Untitled project') : 'Untitled project',
      projectAddress: joinAddress(row),
      // `project_type` and `trade` are empty on every live row today.
      projectType: nonEmpty(row.project_type) ?? nonEmpty(row.trade) ?? '',
      clientName: nonEmpty(row.client_name) ?? '',
      primaryContactId: row.ghl_contact_id ?? '',
      // Not in BuildSuite. Naming a person who has not been assigned is worse
      // than an empty field, which at least reads as "not set".
      projectManager: '',
      superintendent: '',

      // Status — BuildSuite's own word, not the §7 pipeline. See the note on
      // `Project.projectStage`: no mapping between the two is defined.
      sourceStatus: status,
      progressPercentage: 0,
      currentMilestone: '',
      nextMilestone: '',
      clientActionRequired: false,
      healthStatus: status === 'completed' ? 'Completed' : 'On Track',
      lastUpdatedDate: dateOnly(row.updated_at ?? row.created_at),

      // Dates
      estimatedStartDate: dateOnly(row.start_date),
      estimatedCompletionDate: dateOnly(row.end_date),

      // Financials — BuildSuite has a band, not an amount. `hasFinancials()`
      // returns false for this provenance so screens skip these rather than
      // presenting zeros as facts.
      budgetBand: nonEmpty(row.budget_band) ?? undefined,
      contractAmount: 0,
      approvedChangeOrders: 0,
      pendingChangeOrders: 0,
      currentProjectTotal: 0,
      amountInvoiced: 0,
      amountPaid: 0,
      remainingBalance: 0,
      nextPaymentAmount: 0,
      nextPaymentDueDate: '',

      // §9.3 deny-list — zero because BuildSuite holds none of it, and because
      // a real number here would be the single worst thing to get wrong.
      originalEstimate: 0,
      internalMarkup: 0,
      margin: 0,
      internalPriority: 'Normal',
      delayReason: '',
      internalNotes: '',

      // Visibility — every switch off. Fail closed: no human has decided any of
      // this may reach a homeowner.
      clientPortalEnabled: false,
      showBudgetToClient: false,
      showDetailedPricing: false,
      showScheduleToClient: false,
      showAssignedTeam: false,
      showDocuments: false,
      showPhotos: false,
      showDailyUpdates: false,
      showChangeOrders: false,
      allowClientMessaging: false,
      allowIssueSubmission: false,
      allowFileUploads: false,
    };
  }
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Street address is empty on every live row, so this is usually city/state/zip. */
function joinAddress(row: BuildSuiteProjectRow): string {
  return [row.street_address, row.city, row.state, row.postal_code]
    .map((part) => (part === null ? null : part.trim()))
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}

/** Timestamps arrive as ISO with an offset; the screens only ever show a date. */
function dateOnly(value: string | null): string {
  if (value === null) return '';
  return value.slice(0, 10);
}

/** Re-exported for the tenancy test — the predicate every screen relies on. */
export function projectOwnedByScope(scope: TenantScope, project: Project): boolean {
  return ownedByScope(scope, project.ownerAuthProfileId);
}
