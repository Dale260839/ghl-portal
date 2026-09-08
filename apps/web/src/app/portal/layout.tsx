import { redirect } from 'next/navigation';
import { clientProjectsFor } from '@/lib/client-scope';
import { requireAccess } from '@/lib/access';

import Link from 'next/link';

import { AppShell, type NavItem } from '@/components/app-shell';
import { ViewSwitcher, ViewingAsBanner } from '@/components/view-switcher';
import { isViewingAs, viewAsEnabled } from '@/lib/view-as';
import { DataModeBanner } from '@/components/ui';
import { changeOrdersFor } from '@/lib/portal-data';
import { currentDataSource, currentSourceKind } from '@/lib/data/current-source';
import {
  IconBudget,
  IconChangeOrders,
  IconCompletion,
  IconDashboard,
  IconDesigns,
  IconDocuments,
  IconIssues,
  IconMessages,
  IconPayments,
  IconPhotos,
  IconSchedule,
  IconTimeline,
  IconUpdates,
} from '@/components/nav-icons';
import type { Resource } from '@/lib/permissions';

/**
 * Portal routes that a contractor can switch off per person. Routes absent from
 * this map are always shown — see the note where the nav is built.
 */
const RESOURCE_FOR_PORTAL_ROUTE: Record<string, Resource | undefined> = {
  '/portal/schedule': 'milestone',
  '/portal/updates': 'dailyUpdate',
  '/portal/designs': 'selection',
  '/portal/budget': 'invoice',
  '/portal/change-orders': 'changeOrder',
  '/portal/documents': 'document',
  '/portal/photos': 'photo',
  '/portal/issues': 'issue',
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Access, not just a session. A homeowner whose contractor revoked them is
  // out on their next request, not eight hours later when the cookie expires.
  const access = await requireAccess();
  const { session } = access;
  // Contractors may preview the portal; the gate still runs against the
  // project's own contact, so previewing proves the rule rather than skipping it.
  if (session.role !== 'client' && session.role !== 'contractor') redirect('/');

  // The context bar names the project the client is looking at — the demo puts
  // it top-left and it's the fastest orientation cue on the page.
  const db = await currentDataSource();
  let contextTitle = 'Your project';
  let contextSubtitle: string | undefined;

  const viewing = isViewingAs(session);

  // The change-order bell (§6.6): a count of the change orders waiting on the
  // client's decision. The contractor raises one and sends it; this is where it
  // lands. Computed from the same gated read the Change Orders screen uses, so
  // the number in the bell is exactly what they'll find when they open it.
  let waitingChangeOrders = 0;

  if (session.role === 'client') {
    // Same resolution the dashboard uses, so the context bar cannot name a
    // project the page below it does not show.
    const projects = await clientProjectsFor(access, db);
    const first = projects[0];
    if (first !== undefined) {
      contextTitle = first.projectName;
      contextSubtitle = first.projectAddress;
      waitingChangeOrders = changeOrdersFor(first).filter(
        (c) => c.status === 'Awaiting Client',
      ).length;
    }
  }

  /**
   * Which sections this homeowner sees.
   *
   * `access.can` is the role AND their contractor's ticks. Unticking Documents
   * for one client removes it from their navigation on their next request —
   * that is what makes the tick boxes on the Team screen mean something rather
   * than being a record of intent nobody enforces.
   *
   * Dashboard, Timeline and Messages have no tick: the first two are the
   * product's spine and the third is how they reach their contractor at all.
   * A portal you cannot navigate or ask a question in is not a portal.
   */
  const nav: NavItem[] = ([
    { href: '/portal', label: 'Dashboard', icon: IconDashboard },
    { href: '/portal/timeline', label: 'Project Timeline', icon: IconTimeline },
    { href: '/portal/schedule', label: 'Schedule', icon: IconSchedule },
    { href: '/portal/updates', label: 'Daily Updates', icon: IconUpdates },
    { href: '/portal/designs', label: 'Designs & Selections', icon: IconDesigns },
    { href: '/portal/budget', label: 'Budget & Pricing', icon: IconBudget },
    { href: '/portal/change-orders', label: 'Change Orders', icon: IconChangeOrders },
    { href: '/portal/documents', label: 'Documents', icon: IconDocuments },
    { href: '/portal/photos', label: 'Photos & Videos', icon: IconPhotos },
    { href: '/portal/messages', label: 'Messages', icon: IconMessages },
    { href: '/portal/issues', label: 'Issues & Requests', icon: IconIssues },
    { href: '/portal/payments', label: 'Payments', icon: IconPayments },
    { href: '/portal/completion', label: 'Completion & Warranty', icon: IconCompletion },
  ] as (NavItem & { resource?: Resource })[])
    .map((item) => ({
      ...item,
      resource: RESOURCE_FOR_PORTAL_ROUTE[item.href],
    }))
    .filter((item) => item.resource === undefined || access.can('read', item.resource));

  return (
    <AppShell
      brand="APS"
      brandSuffix="Project Hub"
      contextTitle={contextTitle}
      contextSubtitle={contextSubtitle}
      nav={nav}
      userName={session.name}
      headerExtra={
        <>
          <Link
            href="/portal/change-orders"
            aria-label={`Change orders${waitingChangeOrders > 0 ? `, ${waitingChangeOrders} waiting on you` : ''}`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-navy-100 text-navy-500 transition hover:bg-navy-50 hover:text-navy-900"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.268 21a2 2 0 0 0 3.464 0" />
              <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
            </svg>
            {waitingChangeOrders > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-accent px-1 text-[10px] font-semibold text-white">
                {waitingChangeOrders}
              </span>
            )}
          </Link>
          {(session.role === 'contractor' || viewing) && viewAsEnabled() ? (
            <ViewSwitcher current={session.role} viewing={viewing} />
          ) : null}
        </>
      }
      banner={
        <>
          {viewing && <ViewingAsBanner persona={session.name} role={session.role} />}
          <DataModeBanner kind={await currentSourceKind()} />
          {session.role === 'contractor' && (
            <div className="bg-navy-900 px-4 py-1.5 text-center text-xs text-navy-100">
              Contractor preview — showing exactly what the client is served, through the same gate.
            </div>
          )}
        </>
      }
    >
      {children}
    </AppShell>
  );
}
