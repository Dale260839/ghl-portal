import { readGhlConfig } from '../ghl/config.ts';
import { assertScope, type TenantScope } from '../tenancy.ts';
import { CONTACTS, DAILY_UPDATES, ISSUES, MILESTONES, PROJECTS, TASKS } from './fixtures.ts';
import { GhlDataSource } from './ghl-source.ts';
import type { Contact, DailyUpdate, Issue, Milestone, Project, Task } from './types.ts';

/**
 * The seam between the app and wherever project data lives.
 *
 * Two rules shape this file, both learned the hard way:
 *
 * **Every staff read is scoped (D-012).** `TenantScope` is a required first
 * argument. There is no unscoped overload, so forgetting to scope is a type error
 * rather than a leak — the live database has 43 active projects across 5
 * contractors, and an unscoped read returns all of them.
 *
 * **Nothing is cached globally (D-013).** The Hub is one deployment serving many
 * GHL sub-accounts. A module-level singleton would let the first tenant's data
 * source serve the second, so instances are keyed by location.
 */
export interface ProjectDataSource {
  readonly kind: 'fixture' | 'ghl';
  listProjects(scope: TenantScope): Promise<Project[]>;
  getProject(scope: TenantScope, buildsuiteProjectId: string): Promise<Project | null>;
  listMilestones(scope: TenantScope, buildsuiteProjectId: string): Promise<Milestone[]>;
  listTasks(scope: TenantScope, buildsuiteProjectId?: string): Promise<Task[]>;
  listDailyUpdates(scope: TenantScope, buildsuiteProjectId?: string): Promise<DailyUpdate[]>;
  listIssues(scope: TenantScope, buildsuiteProjectId?: string): Promise<Issue[]>;
  getContact(contactId: string): Promise<Contact | null>;
  /**
   * Client-side read: §1.4, a contact may have many projects. Deliberately NOT
   * tenant-scoped — a homeowner's projects can sit with any contractor, and the
   * §9.1 gate is what constrains this one.
   */
  listProjectsForContact(contactId: string): Promise<Project[]>;
}

class FixtureDataSource implements ProjectDataSource {
  readonly kind = 'fixture' as const;

  /** The tenant predicate. Built here from the asserted scope, never passed in. */
  private owns(scope: TenantScope, context: string): (p: Project) => boolean {
    const safe = assertScope(scope, context);
    return (p) => p.ownerAuthProfileId === safe.authProfileId;
  }

  async listProjects(scope: TenantScope): Promise<Project[]> {
    return PROJECTS.filter(this.owns(scope, 'projects'));
  }

  async getProject(scope: TenantScope, id: string): Promise<Project | null> {
    const owns = this.owns(scope, `project ${id}`);
    // Filter before matching, not after — a found-then-rejected lookup is one
    // refactor away from becoming found-then-returned.
    return PROJECTS.filter(owns).find((p) => p.buildsuiteProjectId === id) ?? null;
  }

  private async ownedIds(scope: TenantScope, context: string): Promise<Set<string>> {
    return new Set(PROJECTS.filter(this.owns(scope, context)).map((p) => p.buildsuiteProjectId));
  }

  async listMilestones(scope: TenantScope, id: string): Promise<Milestone[]> {
    const owned = await this.ownedIds(scope, 'milestones');
    if (!owned.has(id)) return [];
    return MILESTONES.filter((m) => m.projectId === id).sort((a, b) => a.sequence - b.sequence);
  }

  async listTasks(scope: TenantScope, id?: string): Promise<Task[]> {
    const owned = await this.ownedIds(scope, 'tasks');
    return TASKS.filter((t) => owned.has(t.projectId) && (id === undefined || t.projectId === id));
  }

  async listDailyUpdates(scope: TenantScope, id?: string): Promise<DailyUpdate[]> {
    const owned = await this.ownedIds(scope, 'daily updates');
    return DAILY_UPDATES.filter(
      (d) => owned.has(d.projectId) && (id === undefined || d.projectId === id),
    ).sort((a, b) => b.updateDate.localeCompare(a.updateDate));
  }

  async listIssues(scope: TenantScope, id?: string): Promise<Issue[]> {
    const owned = await this.ownedIds(scope, 'issues');
    return ISSUES.filter(
      (i) => owned.has(i.projectId) && (id === undefined || i.projectId === id),
    ).sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));
  }

  async getContact(contactId: string): Promise<Contact | null> {
    return CONTACTS.find((c) => c.id === contactId) ?? null;
  }

  async listProjectsForContact(contactId: string): Promise<Project[]> {
    const contact = await this.getContact(contactId);
    if (contact === null) return [];
    return PROJECTS.filter((p) => contact.projectIds.includes(p.buildsuiteProjectId));
  }
}

/**
 * One instance per location, never one for the process (D-013).
 *
 * The key is the location, so two sub-accounts cannot share a source. The
 * fixture source is location-independent, but it uses the same map anyway —
 * a cache that behaves differently in development is a cache that hides the
 * bug it was meant to prevent.
 */
const sources = new Map<string, ProjectDataSource>();

const FIXTURE_KEY = '__fixtures__';

export function getDataSource(scope?: TenantScope): ProjectDataSource {
  const result = readGhlConfig();

  if (!result.configured) {
    if (process.env.GHL_API_BASE_URL !== undefined) {
      console.warn(`[data] Falling back to fixtures. Missing: ${result.missing.join(', ')}`);
    }
    const existing = sources.get(FIXTURE_KEY);
    if (existing !== undefined) return existing;
    const created: ProjectDataSource = new FixtureDataSource();
    sources.set(FIXTURE_KEY, created);
    return created;
  }

  // Live GHL: the instance is bound to a location, so the location must be known.
  const locationId = scope?.ghlLocationId;
  if (locationId === undefined || locationId.trim() === '') {
    throw new Error(
      'GHL is configured but the request carries no locationId — refusing to guess which sub-account (D-013)',
    );
  }

  const existing = sources.get(locationId);
  if (existing !== undefined) return existing;
  const created: ProjectDataSource = new GhlDataSource({ ...result.config, locationId });
  sources.set(locationId, created);
  return created;
}

/** Surfaced in the UI so nobody demos fixtures believing they are live data. */
export function isLiveData(): boolean {
  return readGhlConfig().configured;
}

/** Test seam — the per-location cache must not leak between tests either. */
export function resetDataSources(): void {
  sources.clear();
}
