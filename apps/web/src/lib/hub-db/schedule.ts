import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';

/**
 * Schedule items — the appointments a contractor sets on a project.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `hub_schedule_items` has been in the database since 0001 and nothing has ever
 * read or written it. The Schedule screen renders a hardcoded fixture list and
 * its "New appointment" button is a `<button type="button">` with no handler —
 * the whole screen was a shape with nothing behind it.
 *
 * ---------------------------------------------------------------------------
 * WHO CAN REACH THIS
 *
 * Every method asserts the contractor, so a scope that cannot resolve one gets
 * nothing rather than everything. On top of that `/dashboard` redirects any
 * session that is not a contractor, so the field crew cannot reach these
 * screens at all — the route is the first gate and this is the second.
 *
 * A client never touches this module. They read the schedule through the
 * portal, where `clientVisible` plus the §9.1 gate decides what they see.
 * ---------------------------------------------------------------------------
 */

/** §6.3 `Schedule Item`, as the Hub stores it. */
export interface ScheduleItem {
  id: string;
  projectId: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  trade: string;
  status: string;
  /** Whether this appointment is released to the homeowner. */
  clientVisible: boolean;
  notes: string;
  createdAt: string;
  createdBy: string | null;
}

/** The statuses the screen offers. Free text in the column, a list here. */
export const SCHEDULE_STATUSES = ['Scheduled', 'In Progress', 'Complete', 'Cancelled'] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

interface ScheduleRow {
  id: string;
  project_id: string;
  title: string | null;
  starts_at: string | null;
  ends_at: string | null;
  trade: string | null;
  status: string | null;
  client_visible: boolean | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

function toItem(row: ScheduleRow): ScheduleItem {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title ?? '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    trade: row.trade ?? '',
    status: row.status ?? 'Scheduled',
    clientVisible: row.client_visible === true,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export class HubSchedule {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private tenant(scope: TenantScope, context: string): {
    filters: Record<string, string>;
    contractorId: string;
  } {
    const contractorId = assertContractor(scope, context);
    return { filters: { contractor_id: `eq.${contractorId}` }, contractorId };
  }

  /**
   * The live schedule for a project, earliest first.
   *
   * Archived rows are excluded here rather than at each call site, so a new
   * screen cannot accidentally show cancelled-and-archived work.
   */
  async listForProject(scope: TenantScope, projectId: string): Promise<ScheduleItem[]> {
    const { filters } = this.tenant(scope, 'schedule');
    if (projectId.trim() === '') return [];

    const rows = await this.client.select<ScheduleRow>({
      from: 'hub_schedule_items',
      filters: { ...filters, project_id: `eq.${projectId}`, archived_at: 'is.null' },
      order: 'starts_at.asc',
      limit: 200,
    });
    return rows.map(toItem);
  }

  async create(
    scope: TenantScope,
    input: {
      projectId: string;
      title: string;
      startsAt?: string | null;
      endsAt?: string | null;
      trade?: string;
      status?: string;
      clientVisible?: boolean;
      notes?: string;
    },
    actor: { name: string },
  ): Promise<ScheduleItem> {
    const { contractorId } = this.tenant(scope, 'create schedule item');
    if (input.title.trim() === '') throw new TypeError('an appointment needs a title');
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');

    // An end before its start is a typo, and a schedule that renders backwards
    // is worse than one that refuses the entry.
    if (input.startsAt != null && input.endsAt != null && input.endsAt < input.startsAt) {
      throw new RangeError('an appointment cannot end before it starts');
    }

    const [row] = await this.client.insert<ScheduleRow>({
      from: 'hub_schedule_items',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          title: input.title.trim(),
          starts_at: input.startsAt ?? null,
          ends_at: input.endsAt ?? null,
          trade: input.trade?.trim() || null,
          status: input.status ?? 'Scheduled',
          // Off by default. A new appointment is the contractor's until they
          // decide to release it — §10's posture, applied to the schedule.
          client_visible: input.clientVisible ?? false,
          notes: input.notes?.trim() || null,
          created_by: actor.name,
        },
      ],
    });
    return toItem(row!);
  }

  /**
   * Edit an appointment. Filtered on the asserted contractor as well as the id,
   * so knowing an id is not enough to change another contractor's schedule.
   */
  async update(
    scope: TenantScope,
    itemId: string,
    patch: {
      title?: string;
      startsAt?: string | null;
      endsAt?: string | null;
      trade?: string;
      status?: string;
      clientVisible?: boolean;
      notes?: string;
    },
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'update schedule item');
    if (itemId.trim() === '') throw new TypeError('itemId is required');
    if (patch.title !== undefined && patch.title.trim() === '') {
      throw new TypeError('an appointment needs a title');
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) values.title = patch.title.trim();
    if (patch.startsAt !== undefined) values.starts_at = patch.startsAt;
    if (patch.endsAt !== undefined) values.ends_at = patch.endsAt;
    if (patch.trade !== undefined) values.trade = patch.trade.trim() || null;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;
    if (patch.notes !== undefined) values.notes = patch.notes.trim() || null;

    await this.client.update({
      from: 'hub_schedule_items',
      filters: { id: `eq.${itemId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
    void actor;
  }

  /**
   * Archive rather than delete. `HubClient` has no delete method at all, and a
   * cancelled appointment is a thing that happened.
   */
  async archive(scope: TenantScope, itemId: string, actor: { name: string }): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive schedule item');
    if (itemId.trim() === '') throw new TypeError('itemId is required');

    await this.client.update({
      from: 'hub_schedule_items',
      filters: { id: `eq.${itemId}`, contractor_id: `eq.${contractorId}`, archived_at: 'is.null' },
      patch: {
        archived_at: new Date().toISOString(),
        archived_by: actor.name,
        updated_at: new Date().toISOString(),
      },
    });
  }
}

export type HubScheduleResult =
  | { available: true; schedule: HubSchedule }
  | { available: false; missing: string[] };

export function getHubSchedule(): HubScheduleResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, schedule: new HubSchedule(hub.client) };
}
