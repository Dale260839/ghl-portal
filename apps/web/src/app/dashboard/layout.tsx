import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOut } from '@/lib/actions';
import { getSession } from '@/lib/session';
import { isLiveData } from '@/lib/data/source';
import { DataModeBanner } from '@/components/ui';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/projects', label: 'Projects' },
  { href: '/dashboard/updates', label: 'Field Updates' },
  { href: '/dashboard/buildsuite', label: 'From BuildSuite' },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  if (session.role !== 'contractor') redirect('/');

  return (
    <div className="min-h-dvh">
      <DataModeBanner live={isLiveData()} />

      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="shrink-0 text-sm font-semibold tracking-tight">
            BuildSuite<span className="align-super text-[0.6em]">™</span>
          </Link>

          <nav className="flex gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-navy-600 transition hover:bg-navy-50 hover:text-navy-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden text-xs text-navy-400 sm:block">
              {session.name} · Project Manager
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-navy-100 px-2.5 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6">{children}</main>
    </div>
  );
}
