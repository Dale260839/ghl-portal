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
  IconBuildSuite,
  IconDashboard,
  IconArchive,
  IconEngagements,
  IconIssues,
  IconTeam,
  IconPipeline,
  IconProjects,
  IconUpdates,
} from '@/components/nav-icons';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'contractor') redirect('/');

  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const devAccounts = await listDevAccounts();

  // Badge counts make the sidebar a worklist rather than a menu — a PM should
  // see from the nav alone that three updates are waiting.
  const [updates, issues] = await Promise.all([db.listDailyUpdates(scope), db.listIssues(scope)]);
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
  const openIssues = issues.filter(
    (i) => i.status !== 'Resolved' && i.status !== 'Closed',
  ).length;

  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: IconDashboard },
    // First after the overview: this is the book of work, and it is what a
    // project manager opens. Everything below it is either upstream of a job
    // (Pipeline) or a detail of one.
    { href: '/dashboard/engagements', label: 'Active Work', icon: IconEngagements },
    // Above Projects because it is upstream of them: a deal becomes a project,
    // and today almost none of them do.
    { href: '/dashboard/pipeline', label: 'Pipeline', icon: IconPipeline },
    { href: '/dashboard/projects', label: 'Projects', icon: IconProjects },
    { href: '/dashboard/updates', label: 'Field Updates', icon: IconUpdates, badge: pendingReview },
    { href: '/dashboard/issues', label: 'Issues', icon: IconIssues, badge: openIssues },
    { href: '/dashboard/buildsuite', label: 'From BuildSuite', icon: IconBuildSuite },
    { href: '/dashboard/team', label: 'Team', icon: IconTeam },
    // Last, because it is where you go to undo something rather than to work.
    { href: '/dashboard/archive', label: 'Archive', icon: IconArchive },
  ];

  return (
    <AppShell
      brand="BuildSuite"
      brandSuffix="Dashboard"
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
