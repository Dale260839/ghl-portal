import { GhlClient } from '../ghl/client.ts';
import type { GhlConfig } from '../ghl/config.ts';
import { GhlNotFoundError } from '../ghl/errors.ts';
import { mapProject, type GhlRecord } from '../ghl/mapper.ts';
import type { ProjectDataSource } from './source.ts';
import type { Contact, DailyUpdate, Milestone, Project, Task } from './types.ts';

/**
 * Live GHL implementation of `ProjectDataSource`.
 *
 * ⚠️ Endpoint paths below are PROVISIONAL, like `mapper.ts`. They follow GHL's
 * documented custom-objects shape but have not been run against a real
 * sub-account — Phase 0 hasn't reported back (`docs/PHASE-0.md` §3). Two of its
 * questions decide whether this class is right or needs restructuring:
 *
 *   1. Can records be queried by a custom field (`BuildSuite Project ID`)
 *      rather than only by GHL's internal record id? `getProject` assumes yes.
 *   2. Can records be filtered by associated contact in ONE call?
 *      `listProjectsForContact` assumes no and filters client-side, which is
 *      correct but wasteful — it is the first thing to optimise once we know.
 *
 * The supporting objects (Milestone, Task, Daily Update) each need their own
 * object key before they can be read; until those exist they return empty
 * rather than guessing at a key and 404ing every request. The screens already
 * render empty states for all three.
 */

const PROJECT_PAGE_SIZE = 100;

export class GhlDataSource implements ProjectDataSource {
  readonly kind = 'ghl' as const;

  private readonly client: GhlClient;
  private readonly config: GhlConfig;

  constructor(config: GhlConfig, client?: GhlClient) {
    this.config = config;
    this.client = client ?? new GhlClient({ config });
  }

  private async searchRecords(query?: Record<string, string | number | undefined>) {
    const response = await this.client.request<{ records?: GhlRecord[] }>({
      path: `/objects/${this.config.projectObjectKey}/records/search`,
      method: 'POST',
      query: { locationId: this.config.locationId, limit: PROJECT_PAGE_SIZE, ...query },
      describe: 'project records',
    });
    return response.records ?? [];
  }

  async listProjects(): Promise<Project[]> {
    return (await this.searchRecords()).map(mapProject);
  }

  async getProject(buildsuiteProjectId: string): Promise<Project | null> {
    // §3.6 — looked up by the shared key, never by name or address.
    try {
      const records = await this.searchRecords({ buildsuite_project_id: buildsuiteProjectId });
      const match = records
        .map(mapProject)
        .find((p) => p.buildsuiteProjectId === buildsuiteProjectId);
      return match ?? null;
    } catch (error) {
      if (error instanceof GhlNotFoundError) return null;
      throw error;
    }
  }

  async getContact(contactId: string): Promise<Contact | null> {
    try {
      const response = await this.client.request<{
        contact?: { id: string; name?: string; email?: string };
      }>({
        path: `/contacts/${contactId}`,
        describe: `contact ${contactId}`,
      });
      const contact = response.contact;
      if (contact === undefined) return null;

      const projects = await this.listProjectsForContactId(contactId);
      return {
        id: contact.id,
        name: contact.name ?? '',
        email: contact.email ?? '',
        projectIds: projects.map((p) => p.buildsuiteProjectId),
      };
    } catch (error) {
      if (error instanceof GhlNotFoundError) return null;
      throw error;
    }
  }

  /** §1.4 — a contact may have many projects. */
  private async listProjectsForContactId(contactId: string): Promise<Project[]> {
    const all = await this.listProjects();
    return all.filter((p) => p.primaryContactId === contactId);
  }

  async listProjectsForContact(contactId: string): Promise<Project[]> {
    return this.listProjectsForContactId(contactId);
  }

  // ── Supporting objects — pending their own object keys ────────────────────
  // Returning empty is the honest failure mode: the screens show their empty
  // states, and nothing silently fabricates a milestone that doesn't exist.

  async listMilestones(_buildsuiteProjectId: string): Promise<Milestone[]> {
    return [];
  }

  async listTasks(_buildsuiteProjectId?: string): Promise<Task[]> {
    return [];
  }

  async listDailyUpdates(_buildsuiteProjectId?: string): Promise<DailyUpdate[]> {
    return [];
  }
}
