'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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

export function SidebarNav({ nav }: { nav: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {nav.map((item) => {
        const active = isActive(pathname, item.href, SECTION_ROOTS);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
              active
                ? 'bg-navy-900 text-white'
                : 'text-navy-600 hover:bg-navy-50 hover:text-navy-900'
            }`}
          >
            <span className={active ? 'text-white' : 'text-navy-400'}>{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={`tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold ${
                  active ? 'bg-white/20 text-white' : 'bg-navy-900 text-white'
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

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-navy-100 bg-white px-3 py-2 lg:hidden">
      {nav.map((item) => {
        const active = isActive(pathname, item.href, SECTION_ROOTS);
        return (
          <Link
            key={item.href}
            href={item.href}
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
