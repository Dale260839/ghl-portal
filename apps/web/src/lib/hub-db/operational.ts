import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';
import type { DailyUpdate, Issue, Milestone, PunchListItem, Task } from '../data/types.ts';

/**
 * The operational records — milestones, tasks, daily updates, issues.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE FILE THAT MAKES THE PRODUCT REMEMBER THINGS.
 *
 * Until it existed, a field update went into an in-memory fixture array while
 * the read path returned `[]` from BuildSuite — so submitting an update did
 * nothing visible, and anything that did work vanished on restart. The screens
 * were real and the storage was not.
 *
 * Everything here reads and writes the **Hub's own database**. BuildSuite holds
 * projects, clients and proposals; it has no concept of a milestone or a field
 * update and never will. That split is the whole architecture: they own the
 * commercial record, we own the operational one.
 * ---------------------------------------------------------------------------
 *
 * Tenancy is the contractor on every read and every write, and it is built from
 * an asserted scope rather than passed in.
 */

// ── Row shapes ──────────────────────────────────────────────────────────────

interface MilestoneRow {
  id: string;
  project_id: string;
  milestone_name: string;
  planned_start: string | null;
  planned_end: string | null;
  status: string;
  sequence: number;
  client_visible: boolean;
  archived_at: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  task_name: string;
  assigned_trade: string | null;
  scheduled_date: string | null;
  status: string;
  client_visible: boolean;
  assigned_to: string | null;
  pm_note: string | null;
  assigned_at: string | null;
  seen_at: string | null;
  archived_at: string | null;
}

interface UpdateRow {
  id: string;
  project_id: string;
  update_date: string;
  submitted_by: string | null;
  work_completed: string | null;
  crew_onsite: number | null;
  hours_worked: number | null;
  weather: string | null;
  internal_notes: string | null;
  client_summary: string | null;
  client_visible: boolean;
  manager_approval_status: string;
  published_date: string | null;
  archived_at: string | null;
}

interface IssueRow {
  id: string;
  project_id: string;
  issue_number: string | null;
  issue_title: string;
  category: string | null;
  description: string | null;
  project_area: string | null;
  priority: string;
  raised_by: string | null;
  raised_by_role: string | null;
  assigned_to: string | null;
  created_at: string;
  target_resolution_date: string | null;
  status: string;
  internal_notes: string | null;
  client_update: string | null;
  resolution: string | null;
  client_confirmation: boolean;
  client_visible: boolean;
  resolved_at: string | null;
  archived_at: string | null;
}

/**
 * An issue as the Hub stores it: `Issue` plus the three columns the shared view
 * model has no room for.
 *
 * `clientVisible` in particular has to travel. `Issue` predates the per-row
 * release switch and carries only `clientUpdate`, so a screen asking "can the
 * homeowner see this row" had nothing to read. Extending rather than widening
 * `Issue` keeps every existing consumer working unchanged.
 */
export interface HubIssue extends Issue {
  /** §9.1 — the contractor's per-row release switch. */
  clientVisible: boolean;
  /** 'contractor', 'field' or 'client'. Drives "client raised" on the punch list. */
  raisedByRole: string;
  resolvedAt: string | null;
}

/**
 * A punch list item is an issue in the `Punch List` category.
 *
 * There is no `hub_punch_list` table and there should not be one: a snag is an
 * issue with a narrower vocabulary. One table means one tenant filter, one
 * archive path and one release switch rather than two of each drifting apart.
 */
export const PUNCH_CATEGORY = 'Punch List';

/**
 * Whether a stored row is a punch item.
 *
 * A function rather than `i.category === PUNCH_CATEGORY` at each call site, and
 * the reason is a type: `Issue['category']` is `IssueCategory` from the
 * contracts package, and `Punch List` is not one of its eleven values. Comparing
 * them directly is a compile error even though the comparison is exactly right
 * at runtime. Taking a plain `string` states the honest thing — the column holds
 * a category name, and this is the one that means closeout.
 *
 * Widening `IssueCategory` itself would be the alternative, and it would be
 * wrong: `Punch List` is not a kind of problem a person reports, it is which
 * list the row belongs to.
 */
export function isPunchItem(issue: { category: string }): boolean {
  return issue.category === PUNCH_CATEGORY;
}

/** The statuses an issue may hold. Kept in one place so a select cannot invent one. */
export const ISSUE_STATUSES: readonly Issue['status'][] = [
  'Open',
  'Assigned',
  'In Progress',
  'Resolved',
  'Closed',
];

/**
 * Punch list vocabulary over the issue statuses.
 *
 * The closeout list says Open / Scheduled / Completed / Verified because that is
 * what a site manager calls those four states. The stored value is still an
 * issue status, so nothing needs a second status column and a punch item that
 * gets re-categorised keeps a meaningful state.
 */
export const PUNCH_STATUSES: readonly PunchListItem['status'][] = [
  'Open',
  'Scheduled',
  'Completed',
  'Verified',
];

export const ISSUE_STATUS_FOR_PUNCH: Record<PunchListItem['status'], Issue['status']> = {
  Open: 'Open',
  Scheduled: 'In Progress',
  Completed: 'Resolved',
  Verified: 'Closed',
};

const PUNCH_STATUS_FOR_ISSUE: Record<string, PunchListItem['status']> = {
  Open: 'Open',
  // An assigned snag has a person on it, which on the closeout board reads as
  // scheduled. It is the same state wearing the other vocabulary.
  Assigned: 'Scheduled',
  'In Progress': 'Scheduled',
  Resolved: 'Completed',
  Closed: 'Verified',
};

/** Render a stored issue as the punch item the closeout screens speak in. */
export function punchItemFromIssue(issue: HubIssue): PunchListItem {
  return {
    id: issue.id,
    projectId: issue.projectId,
    itemNumber: issue.issueNumber,
    title: issue.issueTitle,
    location: issue.projectArea,
    description: issue.description,
    status: PUNCH_STATUS_FOR_ISSUE[issue.status] ?? 'Open',
    reportedBy: issue.reportedBy,
    raisedByClient: issue.raisedByRole.toLowerCase() === 'client',
    targetDate: issue.targetResolutionDate ?? '',
    completedDate: issue.resolvedAt === null ? '' : issue.resolvedAt.slice(0, 10),
    internalNotes: issue.internalNotes,
    clientVisible: issue.clientVisible,
  };
}

const str = (v: string | null | undefined): string => v ?? '';

function toMilestone(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    projectId: r.project_id,
    milestoneName: r.milestone_name,
    plannedStart: str(r.planned_start),
    plannedEnd: str(r.planned_end),
    status: r.status as Milestone['status'],
    sequence: r.sequence,
    clientVisible: r.client_visible,
  };
}

function toTask(r: TaskRow): Task {
  return {
    id: r.id,
    projectId: r.project_id,
    taskName: r.task_name,
    assignedTrade: str(r.assigned_trade),
    scheduledDate: str(r.scheduled_date),
    status: r.status as Task['status'],
    clientVisible: r.client_visible,
    assignedTo: r.assigned_to,
    pmNote: str(r.pm_note),
    assignedAt: str(r.assigned_at),
    seenAt: r.seen_at,
  };
}

function toUpdate(r: UpdateRow): DailyUpdate {
  return {
    id: r.id,
    projectId: r.project_id,
    updateDate: r.update_date,
    submittedBy: str(r.submitted_by),
    workCompleted: str(r.work_completed),
    crewOnsite: r.crew_onsite ?? 0,
    hoursWorked: r.hours_worked ?? 0,
    weather: str(r.weather),
    internalNotes: str(r.internal_notes),
    clientSummary: str(r.client_summary),
    clientVisible: r.client_visible,
    managerApprovalStatus: r.manager_approval_status as DailyUpdate['managerApprovalStatus'],
    publishDate: r.published_date,
  };
}

function toIssue(r: IssueRow): HubIssue {
  return {
    id: r.id,
    projectId: r.project_id,
    issueNumber: str(r.issue_number),
    issueTitle: r.issue_title,
    category: (r.category ?? 'Other') as Issue['category'],
    description: str(r.description),
    projectArea: str(r.project_area),
    priority: (r.priority as Issue['priority']) ?? 'Normal',
    reportedBy: str(r.raised_by),
    assignedTo: r.assigned_to,
    submittedDate: r.created_at.slice(0, 10),
    targetResolutionDate: r.target_resolution_date,
    status: r.status as Issue['status'],
    internalNotes: str(r.internal_notes),
    clientUpdate: str(r.client_update),
    resolution: str(r.resolution),
    clientConfirmation: r.client_confirmation,
    clientVisible: r.client_visible === true,
    raisedByRole: str(r.raised_by_role),
    resolvedAt: r.resolved_at ?? null,
  };
}

// ── The repository ──────────────────────────────────────────────────────────

export class HubOperational {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  /**
   * The contractor these rows belong to.
   *
   * `assertContractor`, not `assertScope`. An auth profile id is a different id
   * and putting one in `contractor_id` is what made a contractor's own records
   * invisible to them on 2026-09-01. A session with no contractor throws rather
   * than falling back — the fallback was the bug.
   */
  private tenant(scope: TenantScope, context: string): { filters: Record<string, string>; contractorId: string } {
    const contractorId = assertContractor(scope, context);
    return { filters: { contractor_id: `eq.${contractorId}` }, contractorId };
  }

  /**
   * Archived rows are excluded from every list, everywhere.
   *
   * Doing it here rather than at each call site means a new screen cannot
   * accidentally show archived work — the only way to see it is the Archive
   * screen, which asks for it explicitly.
   */
  private live(filters: Record<string, string>): Record<string, string> {
    return { ...filters, archived_at: 'is.null' };
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  async listMilestones(scope: TenantScope, projectId: string): Promise<Milestone[]> {
    const { filters } = this.tenant(scope, 'milestones');
    const rows = await this.client.select<MilestoneRow>({
      from: 'hub_milestones',
      filters: this.live({ ...filters, project_id: `eq.${projectId}` }),
      order: 'sequence.asc',
      limit: 200,
    });
    return rows.map(toMilestone);
  }

  async listTasks(scope: TenantScope, projectId?: string): Promise<Task[]> {
    const { filters } = this.tenant(scope, 'tasks');
    const rows = await this.client.select<TaskRow>({
      from: 'hub_tasks',
      filters: this.live(projectId === undefined ? filters : { ...filters, project_id: `eq.${projectId}` }),
      order: 'created_at.desc',
      limit: 500,
    });
    return rows.map(toTask);
  }

  async listDailyUpdates(scope: TenantScope, projectId?: string): Promise<DailyUpdate[]> {
    const { filters } = this.tenant(scope, 'daily updates');
    const rows = await this.client.select<UpdateRow>({
      from: 'hub_daily_updates',
      filters: this.live(projectId === undefined ? filters : { ...filters, project_id: `eq.${projectId}` }),
      order: 'update_date.desc',
      limit: 500,
    });
    return rows.map(toUpdate);
  }

  async listIssues(scope: TenantScope, projectId?: string): Promise<HubIssue[]> {
    const { filters } = this.tenant(scope, 'issues');
    const rows = await this.client.select<IssueRow>({
      from: 'hub_issues',
      filters: this.live(projectId === undefined ? filters : { ...filters, project_id: `eq.${projectId}` }),
      order: 'created_at.desc',
      limit: 500,
    });
    return rows.map(toIssue);
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * A crew member files an update.
   *
   * It lands as `Pending` and `client_visible = false`. That is the §10 rule in
   * its most literal form: nothing a crew member writes reaches a homeowner
   * until a person decides it should, and the default is the safe one.
   */
  async createUpdate(
    scope: TenantScope,
    input: {
      projectId: string;
      submittedBy: string;
      workCompleted: string;
      crewOnsite: number;
      hoursWorked: number;
      weather: string;
      internalNotes: string;
      blocker?: string;
      safetyConcern?: boolean;
      clientDecisionNeeded?: boolean;
    },
  ): Promise<DailyUpdate> {
    const { filters: _f, contractorId } = this.tenant(scope, 'submit update');

    const [row] = await this.client.insert<UpdateRow>({
      from: 'hub_daily_updates',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          update_date: new Date().toISOString().slice(0, 10),
          submitted_by: input.submittedBy,
          work_completed: input.workCompleted,
          crew_onsite: input.crewOnsite,
          hours_worked: input.hoursWorked,
          weather: input.weather,
          internal_notes: input.internalNotes,
          // Empty, not a copy of the internal note. The PM writes what the
          // client reads; nothing copies one field into the other, which is why
          // an internal complaint provably cannot leak.
          client_summary: '',
          manager_approval_status: 'Pending',
          client_visible: false,
          blocker: input.blocker ?? null,
          safety_concern: input.safetyConcern ?? false,
          client_decision_needed: input.clientDecisionNeeded ?? false,
        },
      ],
    });
    return toUpdate(row!);
  }

  /** PM edits the text a client will read. No state change. */
  async saveClientSummary(scope: TenantScope, updateId: string, clientSummary: string): Promise<void> {
    const { filters } = this.tenant(scope, 'edit summary');
    await this.client.update({
      from: 'hub_daily_updates',
      filters: { ...filters, id: `eq.${updateId}` },
      patch: { client_summary: clientSummary, updated_at: new Date().toISOString() },
    });
  }

  /**
   * Move an update through the approval states.
   *
   * `client_visible` is derived here rather than passed in. Only
   * `Approved & Published` sets it true — the state and the visibility can never
   * drift apart, because one is computed from the other in a single place.
   */
  async setApproval(
    scope: TenantScope,
    updateId: string,
    status: DailyUpdate['managerApprovalStatus'],
    today: string,
  ): Promise<void> {
    const { filters } = this.tenant(scope, 'approve update');
    const published = status === 'Approved & Published';

    await this.client.update({
      from: 'hub_daily_updates',
      filters: { ...filters, id: `eq.${updateId}` },
      patch: {
        manager_approval_status: status,
        client_visible: published,
        published_date: published ? today : null,
        updated_at: new Date().toISOString(),
      },
    });
  }

  async createMilestone(
    scope: TenantScope,
    input: { projectId: string; milestoneName: string; sequence: number; plannedStart?: string; plannedEnd?: string; clientVisible?: boolean; createdBy: string },
  ): Promise<Milestone> {
    const { contractorId } = this.tenant(scope, 'create milestone');
    const [row] = await this.client.insert<MilestoneRow>({
      from: 'hub_milestones',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          milestone_name: input.milestoneName,
          sequence: input.sequence,
          planned_start: input.plannedStart ?? null,
          planned_end: input.plannedEnd ?? null,
          client_visible: input.clientVisible ?? false,
          created_by: input.createdBy,
        },
      ],
    });
    return toMilestone(row!);
  }

  /**
   * Edit a milestone. Filtered on the asserted contractor as well as the id, so
   * knowing an id is not enough to change another contractor's plan.
   *
   * Only the fields given are written. A patch that always wrote every column
   * would blank a name when the caller meant to change a status.
   */
  async updateMilestone(
    scope: TenantScope,
    milestoneId: string,
    patch: {
      milestoneName?: string;
      sequence?: number;
      status?: string;
      plannedStart?: string | null;
      plannedEnd?: string | null;
      clientVisible?: boolean;
    },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'update milestone');
    if (milestoneId.trim() === '') throw new TypeError('milestoneId is required');
    if (patch.milestoneName !== undefined && patch.milestoneName.trim() === '') {
      throw new TypeError('a milestone needs a name');
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.milestoneName !== undefined) values.milestone_name = patch.milestoneName.trim();
    if (patch.sequence !== undefined) values.sequence = patch.sequence;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.plannedStart !== undefined) values.target_date = patch.plannedStart;
    if (patch.plannedEnd !== undefined) values.completed_date = patch.plannedEnd;
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;

    await this.client.update({
      from: 'hub_milestones',
      filters: { id: `eq.${milestoneId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
  }

  /** Archive rather than delete. A milestone that happened is a record. */
  async archiveMilestone(
    scope: TenantScope,
    milestoneId: string,
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive milestone');
    if (milestoneId.trim() === '') throw new TypeError('milestoneId is required');

    await this.client.update({
      from: 'hub_milestones',
      filters: {
        id: `eq.${milestoneId}`,
        contractor_id: `eq.${contractorId}`,
        archived_at: 'is.null',
      },
      patch: {
        archived_at: new Date().toISOString(),
        archived_by: actor.name,
        updated_at: new Date().toISOString(),
      },
    });
  }

  async createTask(
    scope: TenantScope,
    input: { projectId: string; taskName: string; assignedTrade?: string; assignedTo?: string; pmNote?: string; scheduledDate?: string; createdBy: string },
  ): Promise<Task> {
    const { contractorId } = this.tenant(scope, 'create task');
    const assigned = input.assignedTo ?? null;

    const [row] = await this.client.insert<TaskRow>({
      from: 'hub_tasks',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          task_name: input.taskName,
          assigned_trade: input.assignedTrade ?? null,
          assigned_to: assigned,
          pm_note: input.pmNote ?? null,
          scheduled_date: input.scheduledDate ?? null,
          // The "ding" starts the moment it is assigned to someone. Unassigned
          // work has nobody to notify, so it carries no timestamp.
          assigned_at: assigned === null ? null : new Date().toISOString(),
          created_by: input.createdBy,
        },
      ],
    });
    return toTask(row!);
  }

  async setTaskStatus(scope: TenantScope, taskId: string, status: string): Promise<void> {
    const { filters } = this.tenant(scope, 'update task');
    await this.client.update({
      from: 'hub_tasks',
      filters: { ...filters, id: `eq.${taskId}` },
      patch: { status, updated_at: new Date().toISOString() },
    });
  }

  /** Clears the badge. Idempotent — acknowledging twice is not an error. */
  async markTaskSeen(scope: TenantScope, taskId: string): Promise<void> {
    const { filters } = this.tenant(scope, 'acknowledge task');
    await this.client.update({
      from: 'hub_tasks',
      filters: { ...filters, id: `eq.${taskId}` },
      patch: { seen_at: new Date().toISOString() },
    });
  }

  /**
   * The next per-project reference, e.g. `007`.
   *
   * Counts what is already there, archived rows included — a number that has
   * been said out loud on site must never come back attached to something else.
   *
   * RACE: two people filing at the same instant get the same number. Accepted
   * for the pilot rather than adding a sequence table or a unique index that
   * would turn a collision into a failed submission on a phone with one bar.
   * The number is a human reference, not a key; the id is the key.
   */
  private async nextIssueNumber(
    filters: Record<string, string>,
    projectId: string,
  ): Promise<string> {
    const existing = await this.client.select<{ id: string }>({
      from: 'hub_issues',
      columns: ['id'],
      filters: { ...filters, project_id: `eq.${projectId}` },
      limit: 1000,
    });
    return String(existing.length + 1).padStart(3, '0');
  }

  async createIssue(
    scope: TenantScope,
    input: {
      projectId: string;
      issueTitle: string;
      category?: string;
      description?: string;
      projectArea?: string;
      priority?: Issue['priority'];
      targetResolutionDate?: string | null;
      internalNotes?: string;
      clientVisible?: boolean;
      raisedBy: string;
      raisedByRole: string;
    },
  ): Promise<HubIssue> {
    const { filters, contractorId } = this.tenant(scope, 'create issue');
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');
    if (input.issueTitle.trim() === '') throw new TypeError('an issue needs a title');

    const issueNumber = await this.nextIssueNumber(filters, input.projectId);

    const [row] = await this.client.insert<IssueRow>({
      from: 'hub_issues',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          issue_number: issueNumber,
          issue_title: input.issueTitle.trim(),
          category: input.category ?? null,
          description: input.description ?? null,
          project_area: input.projectArea?.trim() || null,
          priority: input.priority ?? 'Normal',
          target_resolution_date: input.targetResolutionDate ?? null,
          internal_notes: input.internalNotes ?? null,
          raised_by: input.raisedBy,
          raised_by_role: input.raisedByRole,
          // An issue is internal until someone publishes it, like everything
          // else. A client raising one still does not see the office's notes.
          // The default is false and only a contractor may pass anything else.
          client_visible: input.clientVisible ?? false,
        },
      ],
    });
    return toIssue(row!);
  }

  /**
   * Edit an issue. Filtered on the asserted contractor as well as the id, so
   * knowing an id is not enough to change another contractor's record.
   *
   * Only the fields given are written — a patch that always wrote every column
   * would blank a resolution when the caller meant to change a status.
   *
   * `resolved_at` is DERIVED from the status rather than passed in, the same way
   * `client_visible` is derived on a daily update: the two can never drift apart
   * because one is computed from the other in one place.
   */
  async updateIssue(
    scope: TenantScope,
    issueId: string,
    patch: {
      status?: Issue['status'];
      assignedTo?: string | null;
      resolution?: string;
      clientUpdate?: string;
      clientVisible?: boolean;
      internalNotes?: string;
      targetResolutionDate?: string | null;
      priority?: Issue['priority'];
    },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'update issue');
    if (issueId.trim() === '') throw new TypeError('issueId is required');

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) {
      values.status = patch.status;
      const finished = patch.status === 'Resolved' || patch.status === 'Closed';
      values.resolved_at = finished ? new Date().toISOString() : null;
    }
    if (patch.assignedTo !== undefined) values.assigned_to = patch.assignedTo;
    if (patch.resolution !== undefined) values.resolution = patch.resolution;
    if (patch.clientUpdate !== undefined) values.client_update = patch.clientUpdate;
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;
    if (patch.internalNotes !== undefined) values.internal_notes = patch.internalNotes;
    if (patch.targetResolutionDate !== undefined) {
      values.target_resolution_date = patch.targetResolutionDate;
    }
    if (patch.priority !== undefined) values.priority = patch.priority;

    await this.client.update({
      from: 'hub_issues',
      filters: { id: `eq.${issueId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
  }

  /** Archive rather than delete. An issue that was raised is a record. */
  async archiveIssue(
    scope: TenantScope,
    issueId: string,
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive issue');
    if (issueId.trim() === '') throw new TypeError('issueId is required');

    await this.client.update({
      from: 'hub_issues',
      filters: {
        id: `eq.${issueId}`,
        contractor_id: `eq.${contractorId}`,
        archived_at: 'is.null',
      },
      patch: {
        archived_at: new Date().toISOString(),
        archived_by: actor.name,
        updated_at: new Date().toISOString(),
      },
    });
  }
}

export type HubOperationalResult =
  | { available: true; ops: HubOperational }
  | { available: false; missing: string[] };

export function getHubOperational(): HubOperationalResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, ops: new HubOperational(hub.client) };
}
