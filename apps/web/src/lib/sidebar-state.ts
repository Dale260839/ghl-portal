/**
 * Whether the sidebar is collapsed to icons, remembered between visits.
 *
 * ---------------------------------------------------------------------------
 * WHY A COOKIE AND NOT `localStorage`
 *
 * The server renders the shell. If the preference lived in `localStorage` the
 * first paint would always be the wide sidebar, and a contractor who collapsed
 * it would watch it snap shut on every hard reload. A cookie is readable during
 * the server render, so the sidebar arrives in the shape they left it.
 *
 * WHY IT IS NOT IN THE SESSION
 *
 * It is written by the browser and therefore controlled by whoever is sitting
 * there. Nothing but layout may depend on it — no permission, no tenant, no
 * query. Keeping it in its own cookie makes that structural rather than a rule
 * somebody has to remember: the session cookie stays signed and server-issued,
 * and this one can be forged all day without reaching anything that matters.
 * ---------------------------------------------------------------------------
 */

export const SIDEBAR_COOKIE = 'hub_sidebar';

const COLLAPSED = 'collapsed';
const EXPANDED = 'expanded';

/** A year. A display preference nobody asked to be asked about twice. */
const REMEMBER_SECONDS = 60 * 60 * 24 * 365;

/**
 * Collapsed only on an exact match.
 *
 * Absent, empty, misspelt or anything else means expanded — the wide sidebar is
 * what a new contractor should meet, and an unreadable value is not a reason to
 * hide every label.
 */
export function isCollapsed(value: string | null | undefined): boolean {
  return value?.trim() === COLLAPSED;
}

/**
 * The `document.cookie` string the browser writes when the toggle is used.
 *
 * `SameSite=Lax` and no `Secure`, because this travels with ordinary navigation
 * and must also work on `http://localhost`. Deliberately not `HttpOnly`: the
 * browser is the only thing that writes it.
 */
export function sidebarCookie(collapsed: boolean): string {
  const value = collapsed ? COLLAPSED : EXPANDED;
  return `${SIDEBAR_COOKIE}=${value}; Path=/; Max-Age=${REMEMBER_SECONDS}; SameSite=Lax`;
}
