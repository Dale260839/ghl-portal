/**
 * A project's sections — the one list the sidebar and the project tabs share.
 *
 * John, 2026-09-15: "Project" becomes a parent in the navigation, with the
 * project's sections beneath it. The same thirteen sections were already the
 * tabs across the top of every project page; they now appear in both places,
 * and both read this list, so a section added or renamed here moves in both at
 * once instead of one of them going stale.
 *
 * People is new: the client, their sign-in, the field crew on this project,
 * and inviting someone TO this project. Invitations used to live on the global
 * Team screen; they are per project now.
 *
 * Pure — no React — so the path logic is testable without a browser.
 */

export interface ProjectSection {
  /** The path segment after `/dashboard/projects/<id>/`. */
  seg: string;
  label: string;
}

export const PROJECT_SECTIONS: readonly ProjectSection[] = [
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

const PROJECT_PATH = /^\/dashboard\/projects\/([^/?#]+)(?:\/([^/?#]+))?/;

/**
 * The project a path is inside, or null.
 *
 * `/dashboard/projects` (the list) and anything outside it is not inside a
 * project. The id is returned as it appears in the path; the page it leads to
 * reads the project through the contractor's own tenant scope, so a value typed
 * into the address bar reaches nothing it could not reach already.
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

/**
 * Where the sidebar's section links point.
 *
 * The project you are IN, when you are in one — so "Schedule" in the sidebar
 * opens this project's schedule, not some other. Otherwise the fallback the
 * layout supplies (the first active project), and null when there is neither:
 * a section link with no project behind it has nowhere honest to go, so it is
 * not rendered.
 */
export function projectSectionBase(pathname: string, fallbackProjectId: string | null): string | null {
  const id = projectIdFromPath(pathname) ?? fallbackProjectId;
  return id === null || id.trim() === '' ? null : `/dashboard/projects/${encodeURIComponent(id)}`;
}
