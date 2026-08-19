import 'server-only';

import { DOCUMENTS, MESSAGES, PHOTOS, SCHEDULE_ITEMS } from './data/portal-fixtures.ts';
import { PROJECTS } from './data/fixtures.ts';
import type { Message, Project, ProjectDocument, ProjectPhoto, ScheduleItem } from './data/types.ts';
import { getSession } from './session.ts';
import { getDataSource } from './data/source.ts';

/**
 * Client-portal reads for the Phase A screens.
 *
 * Every one applies the same two rules the rest of the portal does:
 *
 *   1. **The project's portal must be enabled** (§9.1). If a contractor turns
 *      the portal off, no screen returns anything, regardless of per-item flags.
 *   2. **Each item must be client-visible.** Default-deny — the fixtures include
 *      a withheld document and a withheld photo precisely so that a list showing
 *      everything would fail to prove anything.
 *
 * Kept separate from `ProjectDataSource` on purpose: these are portal reads with
 * a fixed shape, not the tenant-scoped staff reads. When the `hub_*` tables are
 * live this file changes and no screen does.
 */

function portalOpen(project: Project): boolean {
  return project.clientPortalEnabled;
}

export function projectFor(buildsuiteProjectId: string): Project | null {
  return PROJECTS.find((p) => p.buildsuiteProjectId === buildsuiteProjectId) ?? null;
}

export function scheduleFor(project: Project): ScheduleItem[] {
  if (!portalOpen(project)) return [];
  // §6.1 — the schedule switch gates this whole screen, not just the dates on it.
  if (!project.showScheduleToClient) return [];
  return SCHEDULE_ITEMS.filter(
    (s) => s.projectId === project.buildsuiteProjectId && s.clientVisible,
  ).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

export function documentsFor(project: Project): ProjectDocument[] {
  if (!portalOpen(project)) return [];
  return DOCUMENTS.filter(
    (d) => d.projectId === project.buildsuiteProjectId && d.clientVisible,
  ).sort((a, b) => b.uploadedDate.localeCompare(a.uploadedDate));
}

export function photosFor(project: Project): ProjectPhoto[] {
  if (!portalOpen(project)) return [];
  return PHOTOS.filter((p) => p.projectId === project.buildsuiteProjectId && p.clientVisible).sort(
    (a, b) => b.takenDate.localeCompare(a.takenDate),
  );
}

export function messagesFor(project: Project): Message[] {
  if (!portalOpen(project)) return [];
  // §6.1 — a contractor can switch client messaging off entirely.
  if (!project.allowClientMessaging) return [];
  return MESSAGES.filter(
    (m) => m.projectId === project.buildsuiteProjectId && m.clientVisible,
  ).sort((a, b) => a.sentDate.localeCompare(b.sentDate));
}

/**
 * The 19 → 6 stage mapping for the client-facing tracker.
 *
 * PROVISIONAL. The client demo shows six steps; our pipeline (§7) has nineteen,
 * because contractors need that granularity and homeowners do not. Nothing in
 * the architecture says how they collapse, so this is a reading, not a spec —
 * flagged alongside W1–W3 for someone who runs projects to confirm.
 */
export const CLIENT_STAGES = [
  'Planning',
  'Design',
  'Materials',
  'In Progress',
  'Inspection',
  'Completed',
] as const;

export type ClientStage = (typeof CLIENT_STAGES)[number];

const STAGE_MAP: Record<string, ClientStage> = {
  'New Project': 'Planning',
  'Estimate in Development': 'Planning',
  'Estimate Sent': 'Planning',
  'Estimate Approved': 'Planning',
  'Contract Sent': 'Planning',
  'Contract Signed': 'Planning',
  'Deposit Due': 'Planning',
  'Deposit Paid': 'Planning',
  Planning: 'Planning',
  'Design and Selections': 'Design',
  Permitting: 'Design',
  'Materials Ordered': 'Materials',
  Scheduled: 'Materials',
  'In Progress': 'In Progress',
  Inspection: 'Inspection',
  'Punch List': 'Inspection',
  'Final Payment Due': 'Inspection',
  Completed: 'Completed',
  Warranty: 'Completed',
};

export function clientStageFor(projectStage: string): ClientStage {
  // An unmapped stage lands on Planning rather than throwing. A client seeing
  // an early stage is confusing; a client seeing a crashed page is worse.
  return STAGE_MAP[projectStage] ?? 'Planning';
}

export function clientStageIndex(projectStage: string): number {
  return CLIENT_STAGES.indexOf(clientStageFor(projectStage));
}

// ── Resolving which project a portal request is about ───────────────────────

/**
 * The project the current portal request concerns.
 *
 * A client resolves it from their **session**, never from the URL — the
 * `project` query parameter only chooses among projects they already own. A
 * contractor previewing resolves it from the preview id, and the §9.1 gate still
 * runs downstream, so previewing demonstrates the rule instead of bypassing it.
 */
export async function currentPortalProject(params: {
  project?: string;
  preview?: string;
}): Promise<{ project: Project | null; allProjects: Project[] }> {
  const session = await getSession();
  const db = getDataSource();

  if (session?.role === 'client' && session.contactId !== undefined) {
    const allProjects = await db.listProjectsForContact(session.contactId);
    const chosen =
      allProjects.find((p) => p.buildsuiteProjectId === params.project) ?? allProjects[0] ?? null;
    return { project: chosen, allProjects };
  }

  if (session?.role === 'contractor' && params.preview !== undefined) {
    const project = projectFor(params.preview);
    return { project, allProjects: project === null ? [] : [project] };
  }

  // A contractor browsing the portal without a preview id gets the first
  // project they own, so the nav is explorable rather than dead.
  if (session?.role === 'contractor' && session.authProfileIds !== undefined) {
    const owned = PROJECTS.filter((p) => session.authProfileIds!.includes(p.ownerAuthProfileId));
    return { project: owned[0] ?? null, allProjects: owned };
  }

  return { project: null, allProjects: [] };
}
