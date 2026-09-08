'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

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

/** Tinted tile per role, so the three experiences read as three places. */
const ROLE_TINT: Record<Role, string> = {
  contractor: 'bg-navy-900 text-white',
  field: 'bg-amber-soft text-amber-800',
  client: 'bg-emerald-50 text-emerald-700',
};

function RoleGlyph({ role }: { role: Role }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (role === 'contractor') {
    return (
      <svg {...common}>
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    );
  }
  if (role === 'field') {
    return (
      <svg {...common}>
        <path d="M2 18h20M4 18a8 8 0 0 1 16 0" />
        <path d="M12 4v6M9 6v4M15 6v4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

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
        className={`press inline-flex items-center gap-2 rounded-full border py-1 pr-2.5 pl-1 text-xs font-medium shadow-[0_1px_2px_rgba(10,31,68,0.06)] transition-colors ${
          viewing
            ? 'border-amber-accent/40 bg-amber-soft text-amber-800 hover:bg-amber-100'
            : 'border-navy-200 bg-white text-navy-700 hover:border-navy-400/40 hover:bg-navy-50'
        }`}
      >
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full ${ROLE_TINT[current]}`}
        >
          <RoleGlyph role={current} />
        </span>
        <span className="hidden text-navy-400 sm:inline">Viewing as</span>
        <span className="font-semibold">{ROLE_LABEL[current]}</span>
        <svg
          viewBox="0 0 16 16"
          className={`h-3 w-3 text-navy-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          aria-hidden="true"
        >
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
          className="menu-enter absolute right-0 z-30 mt-2 w-80 overflow-hidden rounded-xl border border-navy-100 bg-white p-1.5 shadow-[0_1px_2px_rgba(10,31,68,0.06),0_20px_44px_-18px_rgba(10,31,68,0.4)]"
        >
          <div className="px-2.5 pt-2 pb-2.5">
            <div className="text-[11px] font-semibold tracking-[0.12em] text-navy-400 uppercase">
              Switch experience
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-navy-400">
              One account, three views. Field and client logins arrive with invitations.
            </p>
          </div>

          {VIEW_AS_OPTIONS.map((option) => {
            const active = option.role === current;
            return (
              <form key={option.role} action={viewAs}>
                <input type="hidden" name="role" value={option.role} />
                <SwitchItem
                  active={active}
                  role={option.role}
                  label={option.label}
                  hint={option.hint}
                />
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One menu row. Lives inside its own `<form>` so `useFormStatus` sees that
 * form's pending state: the moment a switch is clicked the row says
 * "Switching…" and the menu locks, instead of sitting inert for the second or
 * two the redirect and the next screen's render take. That gap read as a
 * broken button in the 8 Sep walkthrough.
 */
function SwitchItem({
  active,
  role,
  label,
  hint,
}: {
  active: boolean;
  role: Role;
  label: string;
  hint: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="menuitem"
      disabled={active || pending}
      aria-busy={pending || undefined}
      className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-[background-color,transform] duration-150 ${
        active ? 'bg-navy-50' : 'hover:translate-x-0.5 hover:bg-navy-50'
      } ${pending ? 'opacity-70' : ''}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ROLE_TINT[role]} ${
          pending ? 'animate-pulse' : ''
        }`}
      >
        <RoleGlyph role={role} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-navy-900">{label}</span>
        <span
          className={`mt-0.5 block text-[11px] leading-snug ${pending ? 'font-medium text-amber-700' : 'text-navy-400'}`}
        >
          {pending ? 'Switching…' : hint}
        </span>
      </span>
      {active ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tracking-wide text-navy-600 uppercase ring-1 ring-navy-200 ring-inset">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m5 12 5 5L20 7" />
          </svg>
          Current
        </span>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-navy-200 transition-colors group-hover:text-navy-400"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </button>
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
