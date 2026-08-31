import { redirect } from 'next/navigation';
import { signOut } from '@/lib/actions';
import { requireAccess } from '@/lib/access';
import { activeSourceKind } from '@/lib/data/source';
import { currentDataSource } from '@/lib/data/current-source';
import { requireTenantScope } from '@/lib/scope';
import { DataModeBanner } from '@/components/ui';
import { ViewSwitcher, ViewingAsBanner } from '@/components/view-switcher';
import { FieldNav, type FieldNavItem } from '@/components/field-nav';
import { isViewingAs, viewAsEnabled } from '@/lib/view-as';
import { projectsForField, tasksForField, unseenCount } from '@/lib/field-data';

/**
 * The field shell — mobile-first, app-like (D4 §5, D2 Step 3).
 *
 * Bottom navigation rather than a sidebar, because this is used one-handed on a
 * phone on a job site. The content reserves space for it so the last element on
 * a page is never trapped underneath.
 *
 * The badge on Tasks is D4's "ding": unseen assignments, counted here so it is
 * the same number on every screen rather than each page computing its own.
 */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  // Access, not just a session. For an invited crew member this re-reads the
  // membership on every request, so a contractor revoking them takes effect
  // now rather than at their next login.
  const { session, role } = await requireAccess();
  if (role !== 'field' && role !== 'contractor') redirect('/');

  const viewing = isViewingAs(session);

  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);

  const mine = projectsForField(projects, session.name);
  const unseen = unseenCount(tasksForField(tasks, mine, session.name));

  const nav: FieldNavItem[] = [
    { href: '/field', label: 'Today', icon: 'today' },
    { href: '/field/tasks', label: 'Tasks', icon: 'tasks', badge: unseen },
    { href: '/field/update', label: 'Update', icon: 'update' },
    { href: '/field/messages', label: 'Messages', icon: 'messages' },
  ];

  return (
    <div className="min-h-dvh bg-navy-50">
      {viewing && <ViewingAsBanner persona={session.name} role={session.role} />}
      <DataModeBanner kind={activeSourceKind()} />

      <header className="sticky top-0 z-10 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-navy-900">{session.name}</div>
            <div className="text-xs text-navy-400">
              {mine.length} {mine.length === 1 ? 'project' : 'projects'} assigned
            </div>
          </div>
          <div className="flex items-center gap-2">
            {viewAsEnabled() && (session.role === 'contractor' || viewing) && (
              <ViewSwitcher current={session.role} viewing={viewing} />
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-9 rounded-md border border-navy-100 px-2.5 text-xs font-medium text-navy-600"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* pb-24 clears the fixed bottom nav. Without it the last control on a
          page sits under it and cannot be tapped. */}
      <main className="mx-auto max-w-lg px-4 py-5 pb-24">{children}</main>

      <FieldNav items={nav} />
    </div>
  );
}
