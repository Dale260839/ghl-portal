import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, assertScope, type TenantScope } from '../tenancy.ts';

/**
 * Writing, editing and archiving — the Hub's own records.
 *
 * ---------------------------------------------------------------------------
 * ARCHIVE IS NOT DELETE, AND THE DIFFERENCE IS VISIBLE
 *
 * Archiving sets `archived_at`, `archived_by` and a reason. The row stays. Two
 * reasons this is not merely cautious:
 *
 *   1. The approval model rests on being able to say who published what. A
 *      deleted row destroys the evidence the privacy rules depend on.
 *   2. A contractor who archives the wrong job must be able to get it back
 *      without anyone touching a database.
 *
 * So archiving is reversible, it is attributed, and **there is a screen that
 * lists archived things**. An archive nobody can see is a delete with extra
 * steps.
 * ---------------------------------------------------------------------------
 *
 * A project belongs to BuildSuite and we never write there. Editing or
 * archiving one writes an OVERLAY row here, rendered on top of the BuildSuite
 * record. `hub_project_state` is that overlay.
 */

/** Hub-owned tables that carry `archived_at` and can be archived directly. */
export const ARCHIVABLE_TABLES = [
  'hub_milestones',
  'hub_schedule_items',
  'hub_tasks',
  'hub_daily_updates',
  'hub_issues',
  'hub_documents',
  'hub_photos',
] as const;

export type ArchivableTable = (typeof ARCHIVABLE_TABLES)[number];

/** Human labels, so the Archive screen reads as work rather than as tables. */
export const TABLE_LABELS: Record<ArchivableTable, string> = {
  hub_milestones: 'Milestone',
  hub_schedule_items: 'Schedule item',
  hub_tasks: 'Task',
  hub_daily_updates: 'Field update',
  hub_issues: 'Issue',
  hub_documents: 'Document',
  hub_photos: 'Photo',
};

/** The column that carries a human-readable name, per table. */
const TITLE_COLUMN: Record<ArchivableTable, string> = {
  hub_milestones: 'milestone_name',
  hub_schedule_items: 'title',
  hub_tasks: 'task_name',
  hub_daily_updates: 'client_summary',
  hub_issues: 'issue_title',
  hub_documents: 'title',
  hub_photos: 'caption',
};

export interface Actor {
  name: string;
  role: string;
}

export interface ProjectOverlay {
  projectId: string;
  contractorId: string;
  titleOverride: string | null;
  addressOverride: string | null;
  clientNameOverride: string | null;
  notes: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface OverlayRow {
  project_id: string;
  contractor_id: string;
  title_override: string | null;
  address_override: string | null;
  client_name_override: string | null;
  notes: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
}

function toOverlay(row: OverlayRow): ProjectOverlay {
  return {
    projectId: row.project_id,
    contractorId: row.contractor_id,
    titleOverride: row.title_override,
    addressOverride: row.address_override,
    clientNameOverride: row.client_name_override,
    notes: row.notes,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    archiveReason: row.archive_reason,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export interface ArchivedItem {
  table: ArchivableTable | 'project';
  label: string;
  id: string;
  projectId: string;
  title: string;
  archivedAt: string;
  archivedBy: string;
  reason: string | null;
}

export class HubRecords {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  /**
   * Tenancy, built from the asserted scope and never passed in.
   *
   * The Hub's tenancy key is the **contractor**, per the day-1 finding: a
   * contractor's work is `proposals.contractor_id`, not `projects.auth_profile_id`,
   * which is null on more than half the engaged projects.
   */
  private contractorFilter(scope: TenantScope, context: string): Record<string, string> {
    return { contractor_id: `eq.${assertContractor(scope, context)}` };
  }

  // ── The project overlay ───────────────────────────────────────────────────

  async getOverlays(scope: TenantScope, projectIds: string[]): Promise<ProjectOverlay[]> {
    assertScope(scope, 'project overlays');
    if (projectIds.length === 0) return [];

    const rows = await this.client.select<OverlayRow>({
      from: 'hub_project_state',
      filters: { project_id: `in.(${projectIds.join(',')})` },
      limit: 500,
    });
    return rows.map(toOverlay);
  }

  /**
   * Edit a project. Writes an overlay; BuildSuite is untouched.
   *
   * A field set to `null` means "defer to BuildSuite" and an empty string means
   * "the contractor deliberately cleared it". Those are different intentions and
   * collapsing them would silently resurrect a value someone removed.
   */
  async editProject(
    scope: TenantScope,
    projectId: string,
    contractorId: string,
    patch: Partial<Pick<ProjectOverlay, 'titleOverride' | 'addressOverride' | 'clientNameOverride' | 'notes'>>,
    actor: Actor,
  ): Promise<ProjectOverlay> {
    assertScope(scope, 'edit project');

    const row: Record<string, unknown> = {
      project_id: projectId,
      contractor_id: contractorId,
      updated_at: new Date().toISOString(),
      updated_by: actor.name,
    };
    if ('titleOverride' in patch) row.title_override = patch.titleOverride;
    if ('addressOverride' in patch) row.address_override = patch.addressOverride;
    if ('clientNameOverride' in patch) row.client_name_override = patch.clientNameOverride;
    if ('notes' in patch) row.notes = patch.notes;

    const [saved] = await this.client.upsert<OverlayRow>(
      { from: 'hub_project_state', rows: [row] },
      'project_id',
    );
    await this.recordActivity(scope, {
      projectId,
      contractorId,
      actor,
      action: 'update',
      resource: 'project',
      resourceId: projectId,
      summary: `Edited ${Object.keys(patch).join(', ')}`,
    });
    return toOverlay(saved);
  }

  async archiveProject(
    scope: TenantScope,
    projectId: string,
    contractorId: string,
    actor: Actor,
    reason: string,
  ): Promise<void> {
    assertScope(scope, 'archive project');

    await this.client.upsert<OverlayRow>(
      {
        from: 'hub_project_state',
        rows: [
          {
            project_id: projectId,
            contractor_id: contractorId,
            archived_at: new Date().toISOString(),
            archived_by: actor.name,
            archive_reason: reason,
            updated_at: new Date().toISOString(),
            updated_by: actor.name,
          },
        ],
      },
      'project_id',
    );
    await this.recordActivity(scope, {
      projectId,
      contractorId,
      actor,
      action: 'archive',
      resource: 'project',
      resourceId: projectId,
      summary: reason,
    });
  }

  async restoreProject(
    scope: TenantScope,
    projectId: string,
    contractorId: string,
    actor: Actor,
  ): Promise<void> {
    assertScope(scope, 'restore project');

    await this.client.update({
      from: 'hub_project_state',
      filters: { project_id: `eq.${projectId}` },
      patch: {
        archived_at: null,
        archived_by: null,
        archive_reason: null,
        updated_at: new Date().toISOString(),
        updated_by: actor.name,
      },
    });
    await this.recordActivity(scope, {
      projectId,
      contractorId,
      actor,
      action: 'restore',
      resource: 'project',
      resourceId: projectId,
      summary: 'Restored from archive',
    });
  }

  // ── Hub-owned records ─────────────────────────────────────────────────────

  async archiveRecord(
    scope: TenantScope,
    table: ArchivableTable,
    id: string,
    actor: Actor,
    reason: string,
  ): Promise<void> {
    const filters = this.contractorFilter(scope, `archive ${table}`);

    // Both filters, always: the id says which row, the contractor says whose.
    // Filtering on id alone would let a guessed uuid archive another tenant's
    // record, and PostgREST would happily do it.
    await this.client.update({
      from: table,
      filters: { ...filters, id: `eq.${id}` },
      patch: { archived_at: new Date().toISOString(), archived_by: actor.name },
    });
    await this.recordActivity(scope, {
      projectId: null,
      contractorId: assertContractor(scope, table),
      actor,
      action: 'archive',
      resource: table,
      resourceId: id,
      summary: reason,
    });
  }

  async restoreRecord(
    scope: TenantScope,
    table: ArchivableTable,
    id: string,
    actor: Actor,
  ): Promise<void> {
    const filters = this.contractorFilter(scope, `restore ${table}`);

    await this.client.update({
      from: table,
      filters: { ...filters, id: `eq.${id}` },
      patch: { archived_at: null, archived_by: null },
    });
    await this.recordActivity(scope, {
      projectId: null,
      contractorId: assertContractor(scope, table),
      actor,
      action: 'restore',
      resource: table,
      resourceId: id,
      summary: 'Restored from archive',
    });
  }

  /**
   * Everything this contractor has archived, across every table.
   *
   * One query per table rather than a view, because the tables genuinely differ
   * and a union view would have to invent a shared shape. Seven small filtered
   * reads is the honest version and it is fast enough.
   */
  async listArchived(scope: TenantScope): Promise<ArchivedItem[]> {
    const filters = this.contractorFilter(scope, 'archive');
    const items: ArchivedItem[] = [];

    const overlays = await this.client.select<OverlayRow>({
      from: 'hub_project_state',
      filters: { ...filters, archived_at: 'not.is.null' },
      limit: 500,
    });
    for (const row of overlays) {
      items.push({
        table: 'project',
        label: 'Project',
        id: row.project_id,
        projectId: row.project_id,
        title: row.title_override ?? 'Project',
        archivedAt: row.archived_at!,
        archivedBy: row.archived_by ?? 'unknown',
        reason: row.archive_reason,
      });
    }

    for (const table of ARCHIVABLE_TABLES) {
      const rows = await this.client.select<Record<string, string | null>>({
        from: table,
        filters: { ...filters, archived_at: 'not.is.null' },
        order: 'archived_at.desc',
        limit: 200,
      });
      for (const row of rows) {
        items.push({
          table,
          label: TABLE_LABELS[table],
          id: row.id!,
          projectId: row.project_id!,
          title: row[TITLE_COLUMN[table]] ?? TABLE_LABELS[table],
          archivedAt: row.archived_at!,
          archivedBy: row.archived_by ?? 'unknown',
          reason: null,
        });
      }
    }

    // Most recently archived first — the thing someone archived by mistake is
    // the thing they came here to undo.
    return items.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  // ── Activity ──────────────────────────────────────────────────────────────

  async recordActivity(
    scope: TenantScope,
    entry: {
      projectId: string | null;
      contractorId: string;
      actor: Actor;
      action: string;
      resource: string;
      resourceId: string | null;
      summary: string;
    },
  ): Promise<void> {
    assertScope(scope, 'activity');

    await this.client.insert({
      from: 'hub_activity',
      rows: [
        {
          project_id: entry.projectId,
          contractor_id: entry.contractorId,
          actor: entry.actor.name,
          actor_role: entry.actor.role,
          action: entry.action,
          resource: entry.resource,
          resource_id: entry.resourceId,
          summary: entry.summary,
        },
      ],
    });
  }

  async listActivity(scope: TenantScope, projectId?: string, limit = 50) {
    const filters = this.contractorFilter(scope, 'activity');
    return this.client.select<Record<string, string>>({
      from: 'hub_activity',
      filters: projectId === undefined ? filters : { ...filters, project_id: `eq.${projectId}` },
      order: 'created_at.desc',
      limit,
    });
  }
}

export type HubRecordsResult =
  | { available: true; records: HubRecords }
  | { available: false; missing: string[] };

export function getHubRecords(): HubRecordsResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, records: new HubRecords(hub.client) };
}
