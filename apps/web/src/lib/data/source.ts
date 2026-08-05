import { readGhlConfig } from '../ghl/config.ts';
import { CONTACTS, DAILY_UPDATES, MILESTONES, PROJECTS, TASKS } from './fixtures.ts';
import { GhlDataSource } from './ghl-source.ts';
import type { Contact, DailyUpdate, Milestone, Project, Task } from './types.ts';

/**
 * The seam between the app and wherever project data actually lives.
 *
 * Today: fixtures. Once the integration token lands (KICKOFF §5 F3) a
 * `GhlDataSource` implements the same interface and `getDataSource()` returns it
 * instead. No screen changes — that is the entire point of the seam existing
 * before the credentials do.
 */
export interface ProjectDataSource {
  readonly kind: 'fixture' | 'ghl';
  listProjects(): Promise<Project[]>;
  getProject(buildsuiteProjectId: string): Promise<Project | null>;
  listMilestones(buildsuiteProjectId: string): Promise<Milestone[]>;
  listTasks(buildsuiteProjectId?: string): Promise<Task[]>;
  listDailyUpdates(buildsuiteProjectId?: string): Promise<DailyUpdate[]>;
  getContact(contactId: string): Promise<Contact | null>;
  /** §1.4 — a contact may have many projects. Never returns a single project. */
  listProjectsForContact(contactId: string): Promise<Project[]>;
}

class FixtureDataSource implements ProjectDataSource {
  readonly kind = 'fixture' as const;

  async listProjects(): Promise<Project[]> {
    return PROJECTS;
  }

  async getProject(id: string): Promise<Project | null> {
    return PROJECTS.find((p) => p.buildsuiteProjectId === id) ?? null;
  }

  async listMilestones(id: string): Promise<Milestone[]> {
    return MILESTONES.filter((m) => m.projectId === id).sort((a, b) => a.sequence - b.sequence);
  }

  async listTasks(id?: string): Promise<Task[]> {
    return id === undefined ? TASKS : TASKS.filter((t) => t.projectId === id);
  }

  async listDailyUpdates(id?: string): Promise<DailyUpdate[]> {
    const rows = id === undefined ? DAILY_UPDATES : DAILY_UPDATES.filter((d) => d.projectId === id);
    return [...rows].sort((a, b) => b.updateDate.localeCompare(a.updateDate));
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

let cached: ProjectDataSource | null = null;

/**
 * Live GHL when it is fully configured, fixtures otherwise.
 *
 * Deliberately all-or-nothing: a half-configured environment falls back to
 * fixtures with a warning rather than half-working. A screen showing three real
 * projects and two invented ones is worse than a screen that is clearly a demo.
 */
export function getDataSource(): ProjectDataSource {
  if (cached !== null) return cached;

  const result = readGhlConfig();
  if (result.configured) {
    cached = new GhlDataSource(result.config);
  } else {
    if (process.env.NODE_ENV !== 'test' && process.env.GHL_API_BASE_URL !== undefined) {
      // Partially configured — worth saying out loud, since someone clearly
      // intended live data and is about to demo fixtures instead.
      console.warn(
        `[data] Falling back to fixtures. Missing: ${result.missing.join(', ')}`,
      );
    }
    cached = new FixtureDataSource();
  }
  return cached;
}

/** Surfaced in the UI so nobody demos fixtures believing they are live data. */
export function isLiveData(): boolean {
  return getDataSource().kind === 'ghl';
}
