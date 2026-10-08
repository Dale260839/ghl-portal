import { cookies } from 'next/headers';

import { SubmitButton } from '@/components/submit-button';
import { SIDEBAR_COOKIE, isCollapsed } from '@/lib/sidebar-state';
import type { ReactNode } from 'react';
import { SignOutForm } from './sign-out-form';
import { PageTransition } from './page-transition';
import { MobileNav, type NavItem } from './sidebar-nav';
import { Sidebar } from './sidebar';

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

export async function AppShell({
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
  // Read here, on the server, so a collapsed sidebar paints collapsed rather
  // than opening for one frame and then shutting. It decides a width and
  // nothing else — see `lib/sidebar-state.ts` on why it is its own cookie.
  const sidebarCollapsed = isCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <div className="min-h-dvh bg-navy-50">
      {banner}

      <div className="flex min-h-dvh">
        {/* Sidebar — hidden on mobile, where the top bar carries navigation. */}
        <Sidebar
          brand={brand}
          {...(brandSuffix === undefined ? {} : { brandSuffix })}
          nav={nav}
          defaultCollapsed={sidebarCollapsed}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Context bar */}
          <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-navy-100 bg-white/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/70 sm:px-6">
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
              <SignOutForm>
                <SubmitButton
                  className="press rounded-full border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-600 shadow-[0_1px_2px_rgba(10,31,68,0.06)] transition-colors hover:border-navy-400/40 hover:bg-navy-50"
                >
                  Sign out
                </SubmitButton>
              </SignOutForm>
            </div>
          </header>

          <MobileNav nav={nav} />

          <main className="flex-1 px-4 py-7 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">
              <PageTransition>{children}</PageTransition>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
