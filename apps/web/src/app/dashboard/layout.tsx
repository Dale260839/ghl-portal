import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';

import { AppShell, type NavItem } from '@/components/app-shell';
import { ViewSwitcher } from '@/components/view-switcher';
import { AccountSwitcher } from '@/components/account-switcher';
import { listDevAccounts } from '@/lib/dev-accounts';
import { viewAsEnabled } from '@/lib/view-as';
import { DataModeBanner } from '@/components/ui';
import { currentDataSource, currentSourceKind } from '@/lib/data/current-source';
import {
  IconBudget,
  IconChangeOrders,
  IconCompletion,
  IconDashboard,
  IconDesigns,
  IconDocuments,
  IconInvoices,
  IconIssues,
  IconMessages,
  IconProjects,
  IconReports,
  IconSchedule,
  IconSettings,
  IconTasks,
  IconTeam,
  IconUpdates,
  IconWarranty,
} from '@/components/nav-icons';

import { isActiveProject } from '@/lib/data/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'contractor') redirect('/');

  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const devAccounts = await listDevAccounts();

  // Badge counts make the sidebar a worklist rather than a menu — a PM should
  // see from the nav alone that three updates are waiting.
  const [updates, issues, projects] = await Promise.all([
    db.listDailyUpdates(scope),
    db.listIssues(scope),
    db.listProjects(scope),
  ]);
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
  const openIssues = issues.filter(
    (i) => i.status !== 'Resolved' && i.status !== 'Closed',
  ).length;

  // The per-project screens (Schedule, Change Orders, …) live under a project.
  // The sidebar mirrors the Project Hub design, so those items open the first
  // active project's copy — a populated screen rather than a chooser.
  const firstActive = projects.find(isActiveProject) ?? projects[0];
  const proj = (seg: string): string =>
    firstActive !== undefined
      ? `/dashboard/projects/${firstActive.buildsuiteProjectId}/${seg}`
      : '/dashboard/projects';

  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Portfolio Dashboard', icon: IconDashboard },
    { href: '/dashboard/projects', label: 'Projects', icon: IconProjects },
    { href: proj('schedule'), label: 'Schedule', icon: IconSchedule },
    { href: '/dashboard/engagements', label: 'Tasks', icon: IconTasks },
    { href: '/dashboard/updates', label: 'Field Updates', icon: IconUpdates, badge: pendingReview },
    { href: '/dashboard/team', label: 'Clients', icon: IconTeam },
    { href: proj('designs'), label: 'Designs & Selections', icon: IconDesigns },
    { href: proj('budget'), label: 'Estimates & Budget', icon: IconBudget },
    { href: proj('change-orders'), label: 'Change Orders', icon: IconChangeOrders },
    { href: proj('documents'), label: 'Documents', icon: IconDocuments },
    { href: '/dashboard/issues', label: 'Issues', icon: IconIssues, badge: openIssues },
    { href: proj('messages'), label: 'Messages', icon: IconMessages },
    { href: '/dashboard/invoices', label: 'Invoices & Payments', icon: IconInvoices },
    { href: proj('completion'), label: 'Punch List', icon: IconCompletion },
    { href: proj('completion'), label: 'Warranty', icon: IconWarranty },
    { href: '/dashboard/pipeline', label: 'Reports', icon: IconReports },
    { href: proj('visibility'), label: 'Settings', icon: IconSettings },
  ];

  return (
    <AppShell
      brand="APS"
      brandSuffix="Project Hub"
      contextTitle="Alliance Pro Services"
      contextSubtitle={`${session.name} · Project Manager`}
      nav={nav}
      userName={session.name}
      headerExtra={
        <>
          {/* Development only, and off unless ENABLE_ACCOUNT_SWITCH=true. It
              signs you in as another contractor rather than showing your own
              data through another lens, which is what makes it useful for
              checking tenancy and what makes it unsafe to ship enabled. */}
          {devAccounts.length > 0 && (
            <AccountSwitcher accounts={devAccounts} current={scope.authProfileIds[0]} />
          )}
          {viewAsEnabled() && <ViewSwitcher current="contractor" viewing={false} />}
        </>
      }
      banner={<DataModeBanner kind={await currentSourceKind()} />}
    >
      {children}
    </AppShell>
  );
}
