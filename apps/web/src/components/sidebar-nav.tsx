'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { portalHref } from '@/lib/portal-link';
import { PROJECT_SECTIONS, activeSection, sectionHref } from '@/lib/project-nav';
import { SECTION_ICONS } from './nav-icons';
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
   * 2026-09-15). Inside a project they open that project's section; anywhere
   * else they open the Projects list asking which project — never some project
   * chosen on the contractor's behalf. See `lib/project-nav.ts`.
   */
  projectSections?: true;
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
 * OPEN BY DEFAULT, everywhere. They used to start folded outside a project,
 * which made sense while a section link had nowhere to go without one. Since
 * the chooser (2026-09-15) a section works from any screen — it asks which
 * project — so hiding them only added a click to reach them. The chevron still
 * folds them away; inside a project they stay open, so the section you are on
 * is always visible and lit.
 */
function ProjectSectionLinks({
  pathname,
  open,
  collapsed,
}: {
  pathname: string;
  open: string | null;
  collapsed: boolean;
}) {
  const current = activeSection(pathname, open);
  return (
    <ul
      className={
        collapsed
          ? 'mt-1 mb-1 space-y-0.5 border-t border-white/10 pt-1'
          : 'mt-0.5 mb-1 ml-5 space-y-0.5 border-l border-white/10 pl-2'
      }
    >
      {PROJECT_SECTIONS.map((section) => {
        const active = current === section.seg;
        return (
          <li key={section.seg === '' ? 'overview' : section.seg}>
            <Link
              href={sectionHref(pathname, section.seg)}
              aria-current={active ? 'page' : undefined}
              // The native tooltip is the only label there is once the text is
              // gone. It is not a substitute for the accessible name below —
              // `title` is not reliably announced — it is for the mouse.
              title={collapsed ? section.label : undefined}
              className={`group relative flex items-center rounded-md text-[13px] transition-colors duration-150 ${
                collapsed ? 'mx-auto h-9 w-9 justify-center' : 'gap-2 px-2.5 py-1.5'
              } ${
                active
                  ? 'bg-white/10 font-medium text-white'
                  : 'text-navy-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <span
                className={`shrink-0 transition-colors duration-150 ${
                  active ? 'text-amber-accent' : 'text-navy-400 group-hover:text-navy-200'
                }`}
              >
                {SECTION_ICONS[section.seg]}
              </span>
              {/* Never removed, only hidden. A collapsed sidebar is still a
                  list of named places to a screen reader. */}
              <span className={collapsed ? 'sr-only' : 'flex-1 truncate'}>{section.label}</span>
              {collapsed ? (
                <span className="absolute top-0.5 right-0.5">
                  <LinkPending />
                </span>
              ) : (
                <LinkPending />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarNav({ nav, collapsed = false }: { nav: NavItem[]; collapsed?: boolean }) {
  const pathname = usePathname();
  // Keeps the portal on the project being shown — see `lib/portal-link.ts`.
  const search = useSearchParams();
  const inProjects = pathname === '/dashboard/projects' || pathname.startsWith('/dashboard/projects/');
  const [folded, setFolded] = useState(false);

  return (
    <nav className={`flex-1 space-y-0.5 overflow-y-auto ${collapsed ? 'px-2 py-3' : 'p-3'}`}>
      {nav.map((item) => {
        const active = isActive(pathname, item.href, SECTION_ROOTS);

        if (item.projectSections !== undefined) {
          // Inside a project, always open. Elsewhere, open unless folded.
          //
          // Collapsed overrides the fold. The chevron has nowhere to live at
          // this width, so a folded group would be unreachable — and with no
          // labels there is no visible parent to explain the gap. It would
          // read as missing icons rather than a closed drawer.
          const expanded = collapsed || inProjects || !folded;
          return (
            <div key={`${item.href}::${item.label}`}>
              <div className="flex items-center gap-1">
                <Link
                  href={portalHref(item.href, search)}
                  // The list itself is "active" only on the plain list; inside
                  // a project, or while choosing one, the lit row is below.
                  aria-current={pathname === item.href && search.get('open') === null ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`group relative flex min-w-0 flex-1 items-center rounded-lg text-sm font-medium transition-[background-color,color,transform] duration-150 ${
                    collapsed ? 'h-10 justify-center' : 'gap-3 px-3 py-2.5'
                  } ${
                    inProjects
                      ? 'bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-amber-accent'
                      : 'text-navy-200 hover:bg-white/5 hover:text-white' +
                        (collapsed ? '' : ' hover:translate-x-0.5')
                  }`}
                >
                  <span className={`shrink-0 ${inProjects ? 'text-amber-accent' : 'text-navy-400 group-hover:text-navy-200'}`}>
                    {item.icon}
                  </span>
                  <span className={collapsed ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
                  {collapsed ? (
                    <span className="absolute top-1 right-1">
                      <LinkPending />
                    </span>
                  ) : (
                    <LinkPending />
                  )}
                </Link>
                {!inProjects && !collapsed && (
                  <button
                    type="button"
                    onClick={() => setFolded((v) => !v)}
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
              {expanded && (
                <ProjectSectionLinks
                  pathname={pathname}
                  open={search.get('open')}
                  collapsed={collapsed}
                />
              )}
            </div>
          );
        }

        return (
          <Link
            key={`${item.href}::${item.label}`}
            href={portalHref(item.href, search)}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            className={`group relative flex items-center rounded-lg text-sm font-medium transition-[background-color,color,transform] duration-150 ${
              collapsed ? 'h-10 justify-center' : 'gap-3 px-3 py-2.5'
            } ${
              active
                ? 'bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-amber-accent'
                : 'text-navy-200 hover:bg-white/5 hover:text-white' +
                  (collapsed ? '' : ' hover:translate-x-0.5')
            }`}
          >
            <span
              className={`shrink-0 transition-colors duration-150 ${
                active ? 'text-amber-accent' : 'text-navy-400 group-hover:text-navy-200'
              }`}
            >
              {item.icon}
            </span>
            <span className={collapsed ? 'sr-only' : 'flex-1 truncate'}>{item.label}</span>
            {/* Opposite corner from the badge, which owns the top right. Both
                stay inside the row: the nav scrolls, so a negative offset would
                be clipped or buy a horizontal scrollbar. */}
            {collapsed ? (
              <span className="absolute right-0.5 bottom-0.5">
                <LinkPending />
              </span>
            ) : (
              <LinkPending />
            )}
            {item.badge !== undefined && item.badge > 0 && (
              // Collapsed, the count rides on the corner of the icon. It is the
              // reason the sidebar is a worklist rather than a menu, so it is
              // the one thing that does NOT get hidden to save width — a
              // contractor with three updates waiting must still see three.
              <span
                className={`tabular inline-flex items-center justify-center rounded-full font-semibold ${
                  collapsed
                    ? 'absolute top-0.5 right-0.5 h-4 min-w-4 px-1 text-[10px]'
                    : 'h-5 min-w-5 px-1.5 text-xs'
                } ${active ? 'bg-white/20 text-white' : 'bg-amber-accent text-white'}`}
              >
                {collapsed && item.badge > 9 ? '9+' : item.badge}
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
