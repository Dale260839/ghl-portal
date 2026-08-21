import { redirect } from 'next/navigation';
import { signOut } from '@/lib/actions';
import { getSession } from '@/lib/session';

import { DataModeBanner } from '@/components/ui';
import { DemoToggle } from '@/components/demo-toggle';
import { ViewSwitcher, ViewingAsBanner } from '@/components/view-switcher';
import { demoToggleEnabled, isDemoData } from '@/lib/demo-mode';
import { isViewingAs, viewAsEnabled } from '@/lib/view-as';
import { currentSourceKind } from '@/lib/data/current-source';

export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'field' && session.role !== 'contractor') redirect('/');

  const viewing = isViewingAs(session);
  const demo = await isDemoData();

  return (
    <div className="min-h-dvh bg-navy-50">
      {viewing && <ViewingAsBanner persona={session.name} role={session.role} />}
      <DataModeBanner kind={await currentSourceKind()} />

      <header className="sticky top-0 z-10 border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-navy-900">Today</div>
            <div className="text-xs text-navy-400">{session.name}</div>
          </div>
          <div className="flex items-center gap-2">
            {(session.role === 'contractor' || viewing) && (
              <>
                {demoToggleEnabled() && <DemoToggle on={demo} returnTo="/field" />}
                {viewAsEnabled() && <ViewSwitcher current={session.role} viewing={viewing} />}
              </>
            )}
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-navy-100 px-2.5 py-1.5 text-xs font-medium text-navy-600"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-5 pb-24">{children}</main>
    </div>
  );
}
