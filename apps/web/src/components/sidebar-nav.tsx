'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { portalHref } from '@/lib/portal-link';
import { PROJECT_SECTIONS, projectSectionBase, sectionFromPath } from '@/lib/project-nav';
import type { ReactNode } from 'react';

/**
 * The navigation links, and the only part of the shell that needs to know
 * where you are.
 *
 * This is a client component for one specific reason. **App Router layouts do
 * not re-render when you navigate between their children** — that is the point
 * of a layout, and it is why a layout cannot work out the active route for
 * itself. Reading the path from a header in the layout looked like it worked,
 * because the first page load was correct; every navigation after that left the
 * highlight behind on whichever page you happened to land on first.
 *
 * `usePathname` re-renders on every navigation, and it is also correct during
 * the server render, so there is no flash of the wrong item on first paint.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Omit or pass 0 for no badge. */
  badge?: number;
  /**
   * Makes this item a PARENT whose children are a project's sections (John,
   * 2026-09-15). The sections point at the project you are in; outside one, at
   * this fallback — the first active project — and they are hidden when there
   * is none. See `lib/project-nav.ts`.
   */
  projectSections?: { fallbackProjectId: string | null };
}

/**
 * A section root — `/dashboard`, `/portal` — must not light up for every page
 * beneath it, or it is permanently active and tells you nothing.
 */
function isActive(pathname: string, href: string, roots: readonly string[]): boolean {
  if (pathname === href) return true;
  if (roots.includes(href)) return false;
  return pathname.startsWith(`${href}/`);
}

const SECTION_ROOTS = ['/dashboard', '/portal'] as const;

/**
 * Acknowledges a click the instant it lands.
 *
 * Rendered inside the `<Link>`, so `useLinkStatus` reports that link's own
 * pending navigation. While the next screen is on its way the row shows a
 * pulsing amber dot, so the sidebar answers immediately even when the server
 * takes a second. This is most of what "feels fast" is made of.
 */
function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-accent"
    />
  );
}

/**
 * A project's sections, nested under the "Projects" parent.
 *
 * Open whenever you are inside a project, so the section you are on is always
 * visible and highlighted. Elsewhere it starts closed — fourteen sub-items on
 * every screen would bury the rest of the sidebar — and the chevron opens it.
 */
function ProjectSectionLinks({
  base,
  pathname,
}: {
  base: string;
  pathname: string;
}) {
  const current = pathname.startsWith(`${base}/`) || pathname === base ? sectionFromPath(pathname) : null;
  return (
    <ul className="mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-white/10 pl-2">
      {PROJECT_SECTIONS.map((section) => {
        const active = current === section.seg;
        return (
          <li key={section.seg}>
            <Link
              href={`${base}/${section.seg}`}
              aria-current={active ? 'page' : undefined}
              className={`group relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
                active
                  ? 'bg-white/10 font-medium text-white'
                  : 'text-navy-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span className="flex-1 truncate">{section.label}</span>
              <LinkPending />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();
  // Keeps the portal on the project being shown — see `lib/portal-link.ts`.
  const search = useSearchParams();
  const inProjects = pathname === '/dashboard/projects' || pathname.startsWith('/dashboard/projects/');
  const [opened, setOpened] = useState(false);

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {nav.map((item) => {
        const active = isActive(pathname, item.href, SECTION_ROOTS);

        if (item.projectSections !== undefined) {
          const base = projectSectionBase(pathname, item.projectSections.fallbackProjectId);
          const expanded = base !== null && (inProjects || opened);
          return (
            <div key={`${item.href}::${item.label}`}>
              <div className="flex items-center gap-1">
                <Link
                  href={portalHref(item.href, search)}
                  // The list itself is "active" only on the list; inside a
                  // project the highlighted row is the section below.
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={`group relative flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[background-color,color,transform] duration-150 ${
                    inProjects
                      ? 'bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-amber-accent'
                      : 'text-navy-200 hover:translate-x-0.5 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className={inProjects ? 'text-amber-accent' : 'text-navy-400 group-hover:text-navy-200'}>
                    {item.icon}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                  <LinkPending />
                </Link>
                {base !== null && !inProjects && (
                  <button
                    type="button"
                    onClick={() => setOpened((v) => !v)}
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide project sections' : 'Show project sections'}
                    className="rounded-md p-2 text-navy-400 transition hover:bg-white/5 hover:text-white"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                )}
              </div>
              {expanded && <ProjectSectionLinks base={base} pathname={pathname} />}
            </div>
          );
        }

        return (
          <Link
            key={`${item.href}::${item.label}`}
            href={portalHref(item.href, search)}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-[background-color,color,transform] duration-150 ${
              active
                ? 'bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-amber-accent'
                : 'text-navy-200 hover:translate-x-0.5 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span
              className={`transition-colors duration-150 ${
                active ? 'text-amber-accent' : 'text-navy-400 group-hover:text-navy-200'
              }`}
            >
              {item.icon}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            <LinkPending />
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={`tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                  active ? 'bg-white/20 text-white' : 'bg-amber-accent text-white'
                }`}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** The sidebar's job on a phone. */
export function MobileNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();
  // Keeps the portal on the project being shown — see `lib/portal-link.ts`.
  const search = useSearchParams();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-navy-100 bg-white px-3 py-2 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
      {nav.map((item) => {
        const active = isActive(pathname, item.href, SECTION_ROOTS);
        return (
          <Link
            key={`${item.href}::${item.label}`}
            href={portalHref(item.href, search)}
            aria-current={active ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
              active ? 'bg-navy-900 text-white' : 'text-navy-600 hover:bg-navy-50'
            }`}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="tabular inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-accent px-1 text-[10px] font-semibold text-white">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
