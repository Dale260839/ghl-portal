import { redirect } from 'next/navigation';
import { signOut } from '@/lib/actions';
import { getSession } from '@/lib/session';
import { isLiveData } from '@/lib/data/source';
import { DataModeBanner } from '@/components/ui';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session === null) redirect('/');
  // Contractors may preview the portal; the gate still runs against the
  // project's own contact, so previewing proves the rule rather than skipping it.
  if (session.role !== 'client' && session.role !== 'contractor') redirect('/');

  return (
    <div className="min-h-dvh bg-white">
      <DataModeBanner live={isLiveData()} />

      {session.role === 'contractor' && (
        <div className="bg-navy-900 px-4 py-1.5 text-center text-xs text-navy-100">
          Contractor preview — showing exactly what the client is served, through the same gate.
        </div>
      )}

      <header className="border-b border-navy-100">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div>
            <div className="text-sm font-semibold tracking-tight text-navy-900">
              Alliance Pro Services
            </div>
            <div className="text-xs text-navy-400">Project Portal</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-navy-400 sm:block">{session.name}</span>
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

      <main className="mx-auto max-w-4xl px-4 py-7 sm:px-6">{children}</main>
    </div>
  );
}
