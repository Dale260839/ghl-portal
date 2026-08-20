import type { ReactNode } from 'react';
import { signOut } from '@/lib/actions';
import { MobileNav, SidebarNav, type NavItem } from './sidebar-nav';

/**
 * The shared application shell — left sidebar, context bar, content.
 *
 * Both the contractor dashboard and the client portal use it, so the two read as
 * one product rather than two apps that happen to share a database. The
 * difference between them is the nav items and what the context bar says, not
 * the furniture.
 *
 * The count badges matter more than they look: they're what makes the sidebar
 * a worklist rather than a menu. A contractor should be able to tell from the
 * nav alone that three updates need reviewing.
 *
 * The nav itself lives in `sidebar-nav.tsx` as a client component, because
 * knowing which route is active is the one thing a layout cannot do — see the
 * note there.
 */

export type { NavItem } from './sidebar-nav';

export interface AppShellProps {
  /** Contractor company or product name, top-left. */
  brand: string;
  /** Small label beside the brand — "Client Portal", "Dashboard". */
  brandSuffix?: string;
  /** The thing being worked on. Project name and address, or the user's company. */
  contextTitle?: string;
  contextSubtitle?: string;
  nav: NavItem[];
  userName: string;
  /** Optional strip above everything — the fixtures banner, preview notice. */
  banner?: ReactNode;
  /** Slot in the context bar, left of the user name — the demo view switcher. */
  headerExtra?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  brand,
  brandSuffix,
  contextTitle,
  contextSubtitle,
  nav,
  userName,
  banner,
  headerExtra,
  children,
}: AppShellProps) {
  return (
    <div className="min-h-dvh bg-navy-50">
      {banner}

      <div className="flex min-h-dvh">
        {/* Sidebar — hidden on mobile, where the top bar carries navigation. */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-navy-100 bg-white lg:flex">
          <div className="flex h-16 items-center gap-2.5 border-b border-navy-100 px-5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-navy-900 text-xs font-bold text-white">
              B
            </div>
            <span className="text-sm font-semibold tracking-tight text-navy-900">
              {brand}
              <span className="align-super text-[0.6em]">™</span>
            </span>
            {brandSuffix !== undefined && (
              <span className="border-l border-navy-100 pl-2.5 text-xs text-navy-400">
                {brandSuffix}
              </span>
            )}
          </div>

          <SidebarNav nav={nav} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Context bar */}
          <header className="flex h-16 shrink-0 items-center gap-4 border-b border-navy-100 bg-white px-4 sm:px-6">
            <div className="min-w-0 lg:hidden">
              <span className="text-sm font-semibold tracking-tight text-navy-900">{brand}</span>
            </div>

            {contextTitle !== undefined && (
              <div className="hidden min-w-0 sm:block">
                <div className="truncate text-sm font-semibold text-navy-900">{contextTitle}</div>
                {contextSubtitle !== undefined && (
                  <div className="truncate text-xs text-navy-400">{contextSubtitle}</div>
                )}
              </div>
            )}

            <div className="ml-auto flex shrink-0 items-center gap-3">
              {headerExtra}
              <span className="hidden text-xs text-navy-400 sm:block">{userName}</span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-md border border-navy-100 px-2.5 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>

          <MobileNav nav={nav} />

          <main className="flex-1 px-4 py-7 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
