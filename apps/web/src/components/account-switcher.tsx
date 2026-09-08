'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { switchAccount } from '@/lib/actions';
import { brandCode } from '@/lib/brand';
import type { DevAccount } from '@/lib/dev-accounts';

/**
 * Switch account — **development scaffolding**, and it says so on screen.
 *
 * Sits beside "Viewing as", and the two do different things in a way worth
 * keeping straight:
 *
 *   **Viewing as** shows you YOUR data through another role's lens. It is a
 *   demo aid and it is safe.
 *
 *   **Switch account** signs you in as somebody else entirely — their projects,
 *   their prices, their team. It exists because verifying that tenancy actually
 *   separates two contractors requires being both of them, and no amount of
 *   reasoning substitutes for looking.
 *
 * It renders only when `ENABLE_ACCOUNT_SWITCH=true`, and the label is
 * deliberately unflattering so nobody demos with it open.
 */
/**
 * The second line of an account row. Inside the row's own `<form>`, so
 * `useFormStatus` sees that submission: the instant an account is clicked the
 * line reads "Switching…" rather than leaving the menu inert for the seconds
 * the sign-in, redirect and next render take.
 */
function AccountRowStatus({ email }: { email: string }) {
  const { pending } = useFormStatus();
  if (pending) {
    return (
      <span className="block animate-pulse text-xs font-medium text-amber-700" aria-live="polite">
        Switching…
      </span>
    );
  }
  return <span className="block truncate text-xs text-navy-400">{email}</span>;
}

export function AccountSwitcher({ accounts, current }: { accounts: DevAccount[]; current?: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (accounts.length === 0) return null;

  const active = accounts.find((a) => a.authProfileId === current);
  const needle = filter.trim().toLowerCase();
  const shown =
    needle === ''
      ? accounts
      : accounts.filter(
          (a) =>
            a.email.toLowerCase().includes(needle) ||
            a.businessName.toLowerCase().includes(needle),
        );

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="press inline-flex items-center gap-2 rounded-full border border-amber-accent/40 bg-amber-soft py-1 pr-2.5 pl-1 text-xs font-medium text-amber-800 shadow-[0_1px_2px_rgba(10,31,68,0.06)] transition-colors hover:bg-amber-100"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-accent text-[10px] font-bold text-white">
          {brandCode(active?.businessName ?? active?.email ?? '', 'AF').slice(0, 2)}
        </span>
        <span className="hidden sm:inline">Switch account</span>
        <span className="sm:hidden">Account</span>
        {active !== undefined && (
          <span className="max-w-32 truncate font-normal text-amber-700/80">
            · {active.businessName || active.email}
          </span>
        )}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className={`text-amber-700/70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="menu-enter absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-navy-200 bg-white shadow-[0_1px_2px_rgba(10,31,68,0.06),0_16px_36px_-16px_rgba(10,31,68,0.35)]">
          <div className="flex items-start gap-2.5 border-b border-amber-accent/20 bg-amber-soft px-3.5 py-2.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-accent/15 text-amber-800">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 9v4M12 17h.01" />
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
              </svg>
            </span>
            <span>
              <p className="text-xs font-semibold text-amber-800">Admin: switch account</p>
              <p className="mt-0.5 text-[11px] leading-snug text-amber-700">
                Signs you in as another contractor, with their data. Not a demo feature.
              </p>
            </span>
          </div>

          <div className="border-b border-navy-100 p-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by company or email"
              className="w-full rounded-lg border border-navy-200 px-2.5 py-1.5 text-xs"
            />
          </div>

          <ul className="max-h-80 overflow-y-auto">
            {shown.map((account) => (
              <li key={account.authProfileId}>
                <form action={switchAccount}>
                  <input type="hidden" name="authProfileId" value={account.authProfileId} />
                  <button
                    type="submit"
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-[background-color,transform] duration-150 hover:translate-x-0.5 hover:bg-navy-50 ${
                      account.authProfileId === current ? 'bg-navy-50' : ''
                    }`}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${
                        account.authProfileId === current
                          ? 'bg-navy-900 text-white'
                          : 'bg-navy-100 text-navy-700'
                      }`}
                    >
                      {brandCode(account.businessName || account.email, '?').slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-navy-900">
                        {account.businessName || account.email}
                      </span>
                      <AccountRowStatus email={account.email} />
                      {/* The only question anyone asks of this menu is which
                          account has something to look at. Three of sixty-four
                          do, so the answer is worth putting on the row. */}
                      {account.liveWork > 0 && (
                        <span className="mt-0.5 block text-xs font-medium text-emerald-700">
                          {account.liveWork} live proposal{account.liveWork === 1 ? '' : 's'}
                        </span>
                      )}
                    </span>
                    {/* Unlinked accounts are listed rather than hidden: they are
                        what a real unlinked contractor sees, and the only way to
                        test that path is to be one. */}
                    <span className="mt-0.5 flex shrink-0 flex-col items-end gap-1">
                      {!account.linked && (
                        <span className="rounded-full bg-navy-100 px-1.5 py-0.5 text-[10px] text-navy-600">
                          unlinked
                        </span>
                      )}
                      {account.userType === 'admin' && (
                        <span className="rounded-full bg-navy-100 px-1.5 py-0.5 text-[10px] text-navy-600">
                          admin
                        </span>
                      )}
                    </span>
                  </button>
                </form>
              </li>
            ))}

            {shown.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-navy-400">
                No account matches that filter.
              </li>
            )}
          </ul>

          <p className="border-t border-navy-100 px-3 py-2 text-xs text-navy-400">
            {accounts.filter((a) => a.liveWork > 0).length} with live work ·{' '}
            {accounts.filter((a) => a.linked).length} linked ·{' '}
            {accounts.filter((a) => !a.linked).length} unlinked
          </p>
        </div>
      )}
    </div>
  );
}
