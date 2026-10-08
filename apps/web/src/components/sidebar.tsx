'use client';

import { useState } from 'react';

import { sidebarCookie } from '@/lib/sidebar-state';
import { SidebarNav, type NavItem } from './sidebar-nav';

/**
 * The left sidebar, and the only thing that knows how wide it is.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A COMPONENT AND NOT A CLASS ON THE SHELL
 *
 * Collapsing changes three things at once — the width of the rail, whether the
 * brand carries its name, and whether every row keeps its label. Those have to
 * agree, and they cannot agree across a server/client boundary drawn between
 * them. So the whole rail is one client component holding one piece of state.
 *
 * WHY THE STATE SURVIVES
 *
 * `defaultCollapsed` is read from a cookie during the server render
 * (`lib/sidebar-state.ts`), so a reload paints in the shape the contractor left
 * it rather than snapping open and then shut. Within the app it never reloads
 * at all: this sits in a layout, and App Router layouts are not re-mounted when
 * you navigate between their children.
 * ---------------------------------------------------------------------------
 */
export function Sidebar({
  brand,
  brandSuffix,
  nav,
  defaultCollapsed = false,
  foldedGroups = [],
}: {
  brand: string;
  brandSuffix?: string;
  nav: NavItem[];
  defaultCollapsed?: boolean;
  foldedGroups?: readonly string[];
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Written here rather than through an action: it is a display preference,
    // and a round trip to the server to remember a width would make the
    // animation wait on the network.
    document.cookie = sidebarCookie(next);
  }

  return (
    <aside
      data-collapsed={collapsed ? 'true' : undefined}
      className={`hidden shrink-0 flex-col border-r border-navy-800 bg-navy-950 transition-[width] duration-200 ease-out lg:flex ${
        collapsed ? 'w-[4.5rem]' : 'w-64'
      }`}
    >
      <div
        className={`flex h-16 items-center border-b border-navy-800 ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-5'
        }`}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-accent text-xs font-bold text-navy-950">
          {brand.charAt(0)}
        </div>
        {!collapsed && (
          <>
            <span className="truncate text-sm font-semibold tracking-tight text-white">
              {brand}
              <span className="align-super text-[0.6em]">™</span>
            </span>
            {brandSuffix !== undefined && (
              <span className="border-l border-navy-800 pl-2.5 text-xs whitespace-nowrap text-navy-200">
                {brandSuffix}
              </span>
            )}
          </>
        )}
      </div>

      <SidebarNav nav={nav} collapsed={collapsed} foldedGroups={foldedGroups} />

      {/* At the foot rather than in the header: the brand is already fighting
          for that row at this width, and a control that moves when you use it
          is a control people stop trusting. */}
      <div className="border-t border-navy-800 p-2">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex h-9 w-full items-center rounded-lg text-xs font-medium text-navy-400 transition-colors hover:bg-white/5 hover:text-white ${
            collapsed ? 'justify-center' : 'gap-2 px-3'
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
          >
            <rect width="18" height="18" x="3" y="3" rx="2" />
            <path d="M9 3v18M14 9l-3 3 3 3" />
          </svg>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
