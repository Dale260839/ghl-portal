import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getDataSource, activeSourceKind } from '@/lib/data/source';
import { AppShell, type NavItem } from '@/components/app-shell';
import { ViewSwitcher, ViewingAsBanner } from '@/components/view-switcher';
import { isViewingAs, viewAsEnabled } from '@/lib/view-as';
import { DataModeBanner } from '@/components/ui';
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

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  // Contractors may preview the portal; the gate still runs against the
  // project's own contact, so previewing proves the rule rather than skipping it.
  if (session.role !== 'client' && session.role !== 'contractor') redirect('/');

  // The context bar names the project the client is looking at — the demo puts
  // it top-left and it's the fastest orientation cue on the page.
  const db = getDataSource();
  let contextTitle = 'Your project';
  let contextSubtitle: string | undefined;

  const viewing = isViewingAs(session);

  if (session.role === 'client' && session.contactId !== undefined) {
    const projects = await db.listProjectsForContact(session.contactId);
    const first = projects[0];
    if (first !== undefined) {
      contextTitle = first.projectName;
      contextSubtitle = first.projectAddress;
    }
  }

  const nav: NavItem[] = [
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
  ];

  return (
    <AppShell
      brand="BuildSuite"
      brandSuffix="Client Portal"
      contextTitle={contextTitle}
      contextSubtitle={contextSubtitle}
      nav={nav}
      userName={session.name}
      headerExtra={
        viewAsEnabled() && (session.role === 'contractor' || viewing) ? (
          <ViewSwitcher current={session.role} viewing={viewing} />
        ) : null
      }
      banner={
        <>
          {viewing && <ViewingAsBanner persona={session.name} role={session.role} />}
          <DataModeBanner kind={activeSourceKind()} />
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
