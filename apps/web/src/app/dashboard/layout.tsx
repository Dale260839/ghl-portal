import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';
import { getDataSource, isLiveData } from '@/lib/data/source';
import { AppShell, type NavItem } from '@/components/app-shell';
import { ViewSwitcher } from '@/components/view-switcher';
import { viewAsEnabled } from '@/lib/view-as';
import { DataModeBanner } from '@/components/ui';
import {
  IconBuildSuite,
  IconDashboard,
  IconIssues,
  IconProjects,
  IconUpdates,
} from '@/components/nav-icons';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'contractor') redirect('/');

  const scope = await requireTenantScope();
  const db = getDataSource(scope);

  // Badge counts make the sidebar a worklist rather than a menu — a PM should
  // see from the nav alone that three updates are waiting.
  const [updates, issues] = await Promise.all([db.listDailyUpdates(scope), db.listIssues(scope)]);
  const pendingReview = updates.filter((u) => u.managerApprovalStatus === 'Pending').length;
  const openIssues = issues.filter(
    (i) => i.status !== 'Resolved' && i.status !== 'Closed',
  ).length;

  const nav: NavItem[] = [
    { href: '/dashboard', label: 'Overview', icon: IconDashboard },
    { href: '/dashboard/projects', label: 'Projects', icon: IconProjects },
    { href: '/dashboard/updates', label: 'Field Updates', icon: IconUpdates, badge: pendingReview },
    { href: '/dashboard/issues', label: 'Issues', icon: IconIssues, badge: openIssues },
    { href: '/dashboard/buildsuite', label: 'From BuildSuite', icon: IconBuildSuite },
  ];

  const activeHref = (await headers()).get('x-pathname') ?? '/dashboard';

  return (
    <AppShell
      brand="BuildSuite"
      brandSuffix="Dashboard"
      contextTitle="Alliance Pro Services"
      contextSubtitle={`${session.name} · Project Manager`}
      nav={nav}
      activeHref={activeHref}
      userName={session.name}
      headerExtra={viewAsEnabled() ? <ViewSwitcher current="contractor" viewing={false} /> : null}
      banner={<DataModeBanner live={isLiveData()} />}
    >
      {children}
    </AppShell>
  );
}
