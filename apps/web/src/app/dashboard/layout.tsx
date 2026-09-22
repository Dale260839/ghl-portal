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
import { ConnectBanner } from '@/components/connect-banner';
import { hasFallbackToken, locationConnected } from '@/lib/ghl/resolve-config';
import { getHubClient } from '@/lib/hub-db/client';
import { currentDataSource, currentSourceKind } from '@/lib/data/current-source';
import {
  IconDashboard,
  IconInvoices,
  IconIssues,
  IconProjects,
  IconReports,
  IconTasks,
  IconTeam,
  IconUpdates,
} from '@/components/nav-icons';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'contractor') redirect('/');

  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  // Badge counts make the sidebar a worklist rather than a menu — a PM should
  // see from the nav alone that three updates are waiting. The business name
  // rides along in the same round: it is what the shell is branded with.
  const [updates, issues, businessName] = await Promise.all([
    db.listDailyUpdates(scope),
    db.listIssues(scope),
    resolveContractorName(scope),
  ]);
  // Chris, 8 Sep: the shell shows the contractor's own code and "Project Hub",
  // never BuildSuite. The code is the business name's initials; the context bar
  // names the business in full. Falls back to Alliance only when the session is
  // not linked to a contractor record.
  const tenantName = businessName ?? 'Alliance Pro Services';
  const hub = getHubClient();
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
  const openIssues = issues.filter(
    (i) => i.status !== 'Resolved' && i.status !== 'Closed',
  ).length;

  // ---------------------------------------------------------------------------
  // "PROJECTS" IS A PARENT NOW (John, 2026-09-15).
  //
  // Its children are the project's own sections — Overview, Timeline through
  // Visibility, and People. Inside a project they open that project's section;
  // anywhere else they open the Projects list asking WHICH project, rather than
  // picking one for the contractor. The tabs that repeated them across the top
  // of every project page are gone.
  //
  // Eight flat entries used to point at those same pages (Schedule, Designs &
  // Selections, Estimates & Budget, Change Orders, Documents, Messages, Punch
  // List and Warranty, and Settings, which was Visibility), always for the FIRST
  // active project, whichever one you were actually looking at. Each now lives
  // once, under the project it belongs to.
  //
  // What stays at the top level is what spans every project: the portfolio,
  // the review queue, the cross-project issue list, invoices, reports, and the
  // Team roster.
  // ---------------------------------------------------------------------------
  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Portfolio Dashboard', icon: IconDashboard },
    {
      href: '/dashboard/projects',
      label: 'Projects',
      icon: IconProjects,
      // Outside a project, a section opens the Projects list asking which
      // project — it no longer quietly opens the first active one.
      projectSections: true,
    },
    { href: '/dashboard/engagements', label: 'Tasks', icon: IconTasks },
    { href: '/dashboard/updates', label: 'Field Updates', icon: IconUpdates, badge: pendingReview },
    { href: '/dashboard/issues', label: 'Issues', icon: IconIssues, badge: openIssues },
    { href: '/dashboard/invoices', label: 'Invoices & Payments', icon: IconInvoices },
    // Everyone across every project, and what each may see. Inviting someone is
    // per project now — on that project's People section.
    { href: '/dashboard/team', label: 'Team', icon: IconTeam },
    { href: '/dashboard/pipeline', label: 'Reports', icon: IconReports },
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
      banner={
        <>
          <DataModeBanner
            kind={await currentSourceKind()}
            hubConnected={hub.available}
            // Contractor screens only — see `hubProblem` on DataModeBanner.
            hubProblem={hub.available ? undefined : hub.missing.join(', ')}
          />
          {/* Asks this sub-account to install the app, if it has not. Renders
              nothing at all when the app is switched off or already connected. */}
          <ConnectBanner
            connected={await locationConnected(scope.locationId)}
            hasFallback={hasFallbackToken(scope.locationId)}
          />
        </>
      }
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
