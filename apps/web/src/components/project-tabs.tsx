'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

import { PROJECT_SECTIONS } from '@/lib/project-nav';

/** Tints the tab while its screen is loading, so a click is never silent. */
function TabLabel({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return <span className={pending ? 'text-amber-accent transition-colors' : undefined}>{label}</span>;
}

/**
 * The tab strip across a project's control screens.
 *
 * A contractor works one project at a time, and inside it needs every surface
 * the client has plus the ones only they get. So the client's left-hand nav
 * becomes this horizontal strip, scoped to a single project id — the same
 * labels, in the same order, so the two sides line up screen for screen.
 *
 * A client component for the reason `sidebar-nav.tsx` spells out: a layout does
 * not re-render on navigation, so only `usePathname` can know which tab is live.
 */

// Overview, then the SAME sections the sidebar nests under "Projects" — one list
// for both (`lib/project-nav.ts`), so a section cannot be added to one and not
// the other.
const TABS: { seg: string; label: string }[] = [{ seg: '', label: 'Overview' }, ...PROJECT_SECTIONS];

export function ProjectTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${id}`;

  // Wraps onto a second row rather than scrolling sideways. The strip used to
  // hide its scrollbar, so on a laptop the last tabs (Issues, Payments,
  // Completion, Visibility) were simply not there as far as the person looking
  // could tell. Chris circled the cut-off "Messages" on 11 Sep.
  return (
    <nav className="-mb-px flex flex-wrap gap-x-1 gap-y-0 border-b border-navy-100">
      {TABS.map((tab) => {
        const href = tab.seg === '' ? base : `${base}/${tab.seg}`;
        const active = tab.seg === '' ? pathname === base : pathname === href;
        return (
          <Link
            key={tab.seg}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`relative shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:origin-left after:rounded-full after:transition-transform after:duration-200 after:ease-out ${
              active
                ? 'text-navy-900 after:scale-x-100 after:bg-navy-900'
                : 'text-navy-500 hover:text-navy-900 after:scale-x-0 after:bg-navy-200 hover:after:scale-x-100'
            }`}
          >
            <TabLabel label={tab.label} />
          </Link>
        );
      })}
    </nav>
  );
}
