import 'server-only';

import type { TenantScope } from '../tenancy.ts';
import type { HubOperational } from '../hub-db/operational.ts';
import type { Contact, DailyUpdate, Issue, Milestone, Project, Task } from './types.ts';
import type { DataSourceKind, ProjectDataSource } from './source.ts';

/**
 * Both halves of the system, behind one interface.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT, AND WHY IT IS A WRAPPER RATHER THAN A REWRITE
 *
 *   BuildSuite owns the commercial record — projects, clients, proposals. Read
 *   only, forever.
 *
 *   The Hub owns the operational record — milestones, tasks, daily updates,
 *   issues. BuildSuite has no concept of these and never will.
 *
 * `BuildSuiteDataSource` already answers the first half correctly and returns
 * `[]` for the second, which was a true statement about a system with nowhere
 * to store them. Now there is somewhere. So this delegates rather than
 * reimplementing: project reads pass straight through, operational reads go to
 * the Hub.
 *
 * That composition is why the fix was small. The seam was already in the right
 * place; it was just plugged into nothing.
 * ---------------------------------------------------------------------------
 */
export class HubBackedDataSource implements ProjectDataSource {
  readonly kind: DataSourceKind;

  private readonly commercial: ProjectDataSource;
  private readonly ops: HubOperational;

  constructor(commercial: ProjectDataSource, ops: HubOperational) {
    this.commercial = commercial;
    this.ops = ops;
    // It reports the underlying source's kind, because that is what the banner
    // is telling a presenter about: where the projects on screen came from.
    this.kind = commercial.kind;
  }

  // ── BuildSuite's half, untouched ──────────────────────────────────────────

  listProjects(scope: TenantScope): Promise<Project[]> {
    return this.commercial.listProjects(scope);
  }

  getProject(scope: TenantScope, id: string): Promise<Project | null> {
    return this.commercial.getProject(scope, id);
  }

  getContact(contactId: string): Promise<Contact | null> {
    return this.commercial.getContact(contactId);
  }

  listProjectsForContact(contactId: string): Promise<Project[]> {
    return this.commercial.listProjectsForContact(contactId);
  }

  listProjectsByIds(projectIds: string[]): Promise<Project[]> {
    return this.commercial.listProjectsByIds(projectIds);
  }

  // ── The Hub's half — the records that used to vanish on restart ───────────

  listMilestones(scope: TenantScope, projectId: string): Promise<Milestone[]> {
    return this.ops.listMilestones(scope, projectId);
  }

  listTasks(scope: TenantScope, projectId?: string): Promise<Task[]> {
    return this.ops.listTasks(scope, projectId);
  }

  listDailyUpdates(scope: TenantScope, projectId?: string): Promise<DailyUpdate[]> {
    return this.ops.listDailyUpdates(scope, projectId);
  }

  listIssues(scope: TenantScope, projectId?: string): Promise<Issue[]> {
    return this.ops.listIssues(scope, projectId);
  }
}
