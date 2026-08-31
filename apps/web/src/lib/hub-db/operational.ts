import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';
import type { DailyUpdate, Issue, Milestone, Task } from '../data/types.ts';

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
  assigned_to: string | null;
  created_at: string;
  target_resolution_date: string | null;
  status: string;
  internal_notes: string | null;
  client_update: string | null;
  resolution: string | null;
  client_confirmation: boolean;
  client_visible: boolean;
  archived_at: string | null;
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

function toIssue(r: IssueRow): Issue {
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
  };
}

// ── The repository ──────────────────────────────────────────────────────────

export class HubOperational {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private tenant(scope: TenantScope, context: string): { filters: Record<string, string>; contractorId: string } {
    const safe = assertScope(scope, context);
    return {
      filters: { contractor_id: `in.(${safe.authProfileIds.join(',')})` },
      contractorId: safe.authProfileIds[0]!,
    };
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

  async listIssues(scope: TenantScope, projectId?: string): Promise<Issue[]> {
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

  async createIssue(
    scope: TenantScope,
    input: { projectId: string; issueTitle: string; category?: string; description?: string; priority?: string; raisedBy: string; raisedByRole: string },
  ): Promise<Issue> {
    const { contractorId } = this.tenant(scope, 'create issue');
    const [row] = await this.client.insert<IssueRow>({
      from: 'hub_issues',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          issue_title: input.issueTitle,
          category: input.category ?? null,
          description: input.description ?? null,
          priority: input.priority ?? 'Normal',
          raised_by: input.raisedBy,
          raised_by_role: input.raisedByRole,
          // An issue is internal until someone publishes it, like everything
          // else. A client raising one still does not see the office's notes.
          client_visible: false,
        },
      ],
    });
    return toIssue(row!);
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
