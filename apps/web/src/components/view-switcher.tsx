'use client';

import { useEffect, useRef, useState } from 'react';

import { returnToMyAccount, viewAs } from '@/lib/actions';
import { VIEW_AS_OPTIONS } from '@/lib/view-as';
import type { Role } from '@/lib/demo-accounts';

/**
 * The demo view switcher (D-016) — temporary, and labelled as such on screen.
 *
 * Field crews and homeowners have no accounts yet, so this is the only way to
 * show their experiences on the deployed site. It says "Demo" in the menu on
 * purpose: a client watching a walkthrough should understand they are seeing one
 * person hop between three views, not three people signed in at once.
 *
 * Delete alongside `lib/view-as.ts` when invitations ship.
 */

const ROLE_LABEL: Record<Role, string> = {
  contractor: 'Contractor',
  field: 'Field',
  client: 'Client',
};

export function ViewSwitcher({ current, viewing }: { current: Role; viewing: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Worth the few lines: a menu left
  // hanging over the screen during a live walkthrough is a distraction the
  // presenter has to apologise for.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
          viewing
            ? 'border-amber-accent bg-amber-soft text-amber-accent'
            : 'border-navy-100 text-navy-600 hover:bg-navy-50'
        }`}
      >
        <span className="hidden sm:inline">Viewing as</span>
        <span className="font-semibold">{ROLE_LABEL[current]}</span>
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-72 overflow-hidden rounded-lg border border-navy-100 bg-white shadow-lg"
        >
          <div className="border-b border-navy-100 bg-navy-50 px-3 py-2">
            <div className="text-[11px] font-semibold tracking-wide text-navy-600 uppercase">
              Switch experience
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-navy-400">
              Demo shortcut. Field and client accounts arrive with email invitations.
            </p>
          </div>

          {VIEW_AS_OPTIONS.map((option) => {
            const active = option.role === current;
            return (
              <form key={option.role} action={viewAs}>
                <input type="hidden" name="role" value={option.role} />
                <button
                  type="submit"
                  role="menuitem"
                  disabled={active}
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition ${
                    active ? 'bg-navy-50' : 'hover:bg-navy-50'
                  }`}
                >
                  <span
                    className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                      active ? 'bg-amber-accent' : 'bg-navy-200'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-navy-900">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-navy-400">
                      {option.hint}
                    </span>
                  </span>
                  {active && (
                    <span className="mt-0.5 text-[10px] font-semibold text-navy-400">CURRENT</span>
                  )}
                </button>
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The strip that stops an assumed view being mistaken for a real one.
 *
 * It renders above everything and cannot be dismissed. A contractor who forgets
 * they are looking at the client portal will conclude the portal is missing all
 * their data — and the correct reading is that the gate is working.
 */
export function ViewingAsBanner({ persona, role }: { persona: string; role: Role }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-accent px-4 py-1.5 text-center text-xs text-white">
      <span>
        Viewing as <strong className="font-semibold">{persona}</strong> — the{' '}
        {ROLE_LABEL[role].toLowerCase()} experience. This is your own account assuming another view.
      </span>
      <form action={returnToMyAccount}>
        <button
          type="submit"
          className="rounded-sm bg-white/20 px-2 py-0.5 font-semibold whitespace-nowrap transition hover:bg-white/30"
        >
          Back to my account
        </button>
      </form>
    </div>
  );
}
