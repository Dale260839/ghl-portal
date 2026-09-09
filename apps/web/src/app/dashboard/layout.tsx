import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';
import { resolveContractorName } from '@/lib/buildsuite/contractor-identity';
import { brandCode } from '@/lib/brand';

import { AppShell, type NavItem } from '@/components/app-shell';
import { ViewSwitcher } from '@/components/view-switcher';
import { AccountSwitcher } from '@/components/account-switcher';
import { listDevAccounts } from '@/lib/dev-accounts';
import { viewAsEnabled } from '@/lib/view-as';
import { DataModeBanner } from '@/components/ui';
import { getHubClient } from '@/lib/hub-db/client';
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

  // Badge counts make the sidebar a worklist rather than a menu — a PM should
  // see from the nav alone that three updates are waiting. The business name
  // rides along in the same round: it is what the shell is branded with.
  const [updates, issues, projects, businessName] = await Promise.all([
    db.listDailyUpdates(scope),
    db.listIssues(scope),
    db.listProjects(scope),
    resolveContractorName(scope),
  ]);
  // Chris, 8 Sep: the shell shows the contractor's own code and "Project Hub",
  // never BuildSuite. The code is the business name's initials; the context bar
  // names the business in full. Falls back to Alliance only when the session is
  // not linked to a contractor record.
  const tenantName = businessName ?? 'Alliance Pro Services';
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
      brand={brandCode(tenantName)}
      brandSuffix="Project Hub"
      contextTitle={tenantName}
      contextSubtitle={`${session.name} · Project Manager`}
      nav={nav}
      userName={session.name}
      headerExtra={
        <>
          {/* Development only, and off unless ENABLE_ACCOUNT_SWITCH=true. It
              signs you in as another contractor rather than showing your own
              data through another lens, which is what makes it useful for
              checking tenancy and what makes it unsafe to ship enabled.
              Streamed: its three wide reads must never hold up the page. */}
          <Suspense
            fallback={
              // A visible stand-in, so the admin switch is never "missing" while
              // its account list streams in. Replaced in place by the real pill.
              <span
                aria-hidden="true"
                className="inline-flex items-center gap-2 rounded-full border border-amber-accent/40 bg-amber-soft py-1 pr-2.5 pl-1 text-xs font-medium text-amber-800/70"
              >
                <span className="shimmer h-6 w-6 rounded-full" />
                <span className="hidden sm:inline">Switch account</span>
                <span className="sm:hidden">Account</span>
              </span>
            }
          >
            <AccountSwitcherSlot current={scope.authProfileIds[0]} />
          </Suspense>
          {viewAsEnabled() && <ViewSwitcher current="contractor" viewing={false} />}
        </>
      }
      banner={<DataModeBanner kind={await currentSourceKind()} hubConnected={getHubClient().available} />}
    >
      {children}
    </AppShell>
  );
}

/**
 * The account switcher, loaded on its own. `listDevAccounts` is three wide
 * BuildSuite reads; behind a Suspense boundary the dashboard paints first and
 * the menu appears when they land, instead of the whole screen waiting on it.
 */
async function AccountSwitcherSlot({ current }: { current: string | undefined }) {
  const devAccounts = await listDevAccounts();
  if (devAccounts.length === 0) return null;
  return <AccountSwitcher accounts={devAccounts} current={current} />;
}
