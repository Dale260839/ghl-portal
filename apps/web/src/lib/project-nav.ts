/**
 * A project's sections, and where each sidebar link goes.
 *
 * John, 2026-09-15:
 *
 *   1. "Projects" is a parent in the sidebar, with the project's sections
 *      beneath it.
 *   2. The row of tabs across each project page goes — the sidebar has them.
 *   3. Clicking a section with no project open must NOT silently open some
 *      project. It asks which one: "navigate through project, then make them
 *      choose what project they wanted to view details with."
 *
 * So a section link has two shapes. Inside a project it opens that project's
 * section. Outside one it opens the Projects list in CHOOSER mode
 * (`/dashboard/projects?open=timeline`), where every row opens that project's
 * Timeline instead of its Overview.
 *
 * It used to fall back to the first active project. That opened a populated
 * screen, but for a project the contractor had not picked — and nothing on the
 * screen said so beyond the title.
 *
 * Pure — no React — so the rules are testable without a browser.
 */

export interface ProjectSection {
  /** The path segment after `/dashboard/projects/<id>/`; `''` is Overview. */
  seg: string;
  label: string;
}

/**
 * Overview first — it was the first tab, and without it here a contractor
 * inside a project would have no way back to the project's own summary once
 * the tabs were removed. Then the thirteen sections, then People.
 */
export const PROJECT_SECTIONS: readonly ProjectSection[] = [
  { seg: '', label: 'Overview' },
  { seg: 'timeline', label: 'Timeline' },
  { seg: 'schedule', label: 'Schedule' },
  { seg: 'updates', label: 'Daily Updates' },
  { seg: 'designs', label: 'Designs & Selections' },
  { seg: 'budget', label: 'Budget' },
  { seg: 'change-orders', label: 'Change Orders' },
  { seg: 'documents', label: 'Documents' },
  { seg: 'photos', label: 'Photos & Videos' },
  { seg: 'messages', label: 'Messages' },
  { seg: 'issues', label: 'Issues' },
  { seg: 'payments', label: 'Payments' },
  { seg: 'completion', label: 'Completion' },
  { seg: 'visibility', label: 'Visibility' },
  { seg: 'people', label: 'People' },
];

export const PROJECTS_LIST = '/dashboard/projects';

const PROJECT_PATH = /^\/dashboard\/projects\/([^/?#]+)(?:\/([^/?#]+))?/;

/**
 * The project a path is inside, or null.
 *
 * `/dashboard/projects` (the list) and anything outside it is not inside a
 * project. The page an id leads to reads it through the contractor's own tenant
 * scope, so a value typed into the address bar reaches nothing it could not
 * reach already.
 */
export function projectIdFromPath(pathname: string): string | null {
  const match = PROJECT_PATH.exec(pathname);
  return match === null ? null : decodeURIComponent(match[1]!);
}

/** The section segment of a project path — `''` on the project's Overview. */
export function sectionFromPath(pathname: string): string | null {
  const match = PROJECT_PATH.exec(pathname);
  if (match === null) return null;
  return match[2] ?? '';
}

/** The section named by `?open=`, or null when it names none of ours. */
export function parseOpenSection(value: string | string[] | null | undefined): ProjectSection | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() ?? '';
  if (raw === '') return null;
  return PROJECT_SECTIONS.find((s) => s.seg === raw) ?? null;
}

/** One project's page for one section. */
export function projectSectionPath(projectId: string, seg: string): string {
  const base = `${PROJECTS_LIST}/${encodeURIComponent(projectId)}`;
  return seg === '' ? base : `${base}/${seg}`;
}

/** The Projects list, asking which project to open this section for. */
export function chooserPath(seg: string): string {
  return seg === '' ? PROJECTS_LIST : `${PROJECTS_LIST}?open=${encodeURIComponent(seg)}`;
}

/**
 * Where a sidebar section link goes from here.
 *
 * Inside a project: that project's section. Anywhere else: the chooser. There
 * is deliberately no fallback project — choosing one on the contractor's
 * behalf is what this replaced.
 */
export function sectionHref(pathname: string, seg: string): string {
  const id = projectIdFromPath(pathname);
  return id === null || id.trim() === '' ? chooserPath(seg) : projectSectionPath(id, seg);
}

/**
 * Which section the sidebar should highlight.
 *
 * Inside a project, the one in the path. On the list in chooser mode, the one
 * being chosen for — so a contractor who clicked Timeline sees Timeline lit
 * while they pick. Otherwise none.
 */
export function activeSection(pathname: string, open: string | null | undefined): string | null {
  const inProject = sectionFromPath(pathname);
  if (inProject !== null) return inProject;
  if (pathname === PROJECTS_LIST) return parseOpenSection(open)?.seg ?? null;
  return null;
}
