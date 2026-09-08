'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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

const TABS: { seg: string; label: string }[] = [
  { seg: '', label: 'Overview' },
  { seg: 'timeline', label: 'Timeline' },
  { seg: 'schedule', label: 'Schedule' },
  { seg: 'updates', label: 'Daily Updates' },
  { seg: 'designs', label: 'Designs & Selections' },
  { seg: 'budget', label: 'Budget' },
  { seg: 'change-orders', label: 'Change Orders' },
  { seg: 'documents', label: 'Documents' },
  { seg: 'photos', label: 'Photos & Videos' },
  { seg: 'messages', label: 'Messages' },
  { seg: 'issues', label: 'Issues' },
  { seg: 'payments', label: 'Payments' },
  { seg: 'completion', label: 'Completion' },
  { seg: 'visibility', label: 'Visibility' },
];

export function ProjectTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/dashboard/projects/${id}`;

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-navy-100">
      {TABS.map((tab) => {
        const href = tab.seg === '' ? base : `${base}/${tab.seg}`;
        const active = tab.seg === '' ? pathname === base : pathname === href;
        return (
          <Link
            key={tab.seg}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition ${
              active
                ? 'border-navy-900 text-navy-900'
                : 'border-transparent text-navy-500 hover:border-navy-200 hover:text-navy-900'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
