/**
 * Keeping the portal on the same project while you move between its tabs.
 *
 * ---------------------------------------------------------------------------
 * THE BUG (Chris, huddle 2026-09-10: "keep the preview mode seamless")
 *
 * Every portal page chooses its project from two query parameters —
 * `?preview=<id>` for a contractor looking at the client's view, `?project=<id>`
 * for a homeowner with more than one job (§1.4). The portal's navigation links
 * were bare paths, so the first click on any tab dropped both.
 *
 * What happened next was worse than losing the mode. `currentPortalProject`
 * falls back to the FIRST project when neither is present, so:
 *
 *   · a contractor previewing job B clicked "Schedule" and was shown the
 *     client view of job A — silently, with the same banner saying "preview";
 *   · a homeowner who had picked their second job was put back on their first
 *     with every tab they opened.
 *
 * Both are the wrong project on screen with nothing to say so, which is the
 * failure this Hub is built to prevent.
 *
 * ---------------------------------------------------------------------------
 * WHY CARRYING THEM IS SAFE
 *
 * Neither parameter grants anything. `preview` is read through the contractor's
 * own tenant scope, and `project` only chooses among projects the homeowner
 * already holds — both are re-checked on the server by `currentPortalProject`
 * on every request. Carrying a value forward cannot reach further than typing it
 * into the address bar already could.
 * ---------------------------------------------------------------------------
 */

/** The query parameters that say which project the portal is showing. */
export const PORTAL_CARRIED_PARAMS = ['preview', 'project'] as const;

/**
 * A portal nav link that stays on the current project.
 *
 * Only `/portal` links are touched — the same nav component renders the
 * contractor and field shells, and a dashboard link has no use for either
 * parameter. A value the link already names is left alone, so a link that
 * deliberately points somewhere else still does.
 */
export function portalHref(
  href: string,
  current: { get(name: string): string | null } | null,
): string {
  if (current === null) return href;
  if (href !== '/portal' && !href.startsWith('/portal/') && !href.startsWith('/portal?')) {
    return href;
  }

  const [path, query = ''] = href.split('?', 2) as [string, string?];
  const params = new URLSearchParams(query);

  for (const name of PORTAL_CARRIED_PARAMS) {
    const value = current.get(name)?.trim() ?? '';
    if (value === '' || params.has(name)) continue;
    params.set(name, value);
  }

  const out = params.toString();
  return out === '' ? path : `${path}?${out}`;
}
