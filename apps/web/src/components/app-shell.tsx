import Link from 'next/link';
import type { ReactNode } from 'react';
import { signOut } from '@/lib/actions';

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
 */

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** Omit or pass 0 for no badge. */
  badge?: number;
}

export interface AppShellProps {
  /** Contractor company or product name, top-left. */
  brand: string;
  /** Small label beside the brand — "Client Portal", "Dashboard". */
  brandSuffix?: string;
  /** The thing being worked on. Project name and address, or the user's company. */
  contextTitle?: string;
  contextSubtitle?: string;
  nav: NavItem[];
  activeHref: string;
  userName: string;
  /** Optional strip above everything — the fixtures banner, preview notice. */
  banner?: ReactNode;
  children: ReactNode;
}

export function AppShell({
  brand,
  brandSuffix,
  contextTitle,
  contextSubtitle,
  nav,
  activeHref,
  userName,
  banner,
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

          <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
            {nav.map((item) => {
              // Exact match, or a child route — but the root href must not
              // light up for every page beneath it.
              const active =
                activeHref === item.href ||
                (item.href !== '/dashboard' &&
                  item.href !== '/portal' &&
                  activeHref.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
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

          {/* Mobile nav — the sidebar's job on a phone. */}
          <nav className="flex gap-1 overflow-x-auto border-b border-navy-100 bg-white px-3 py-2 lg:hidden">
            {nav.map((item) => {
              const active = activeHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
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

          <main className="flex-1 px-4 py-7 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
