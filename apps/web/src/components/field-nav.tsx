'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Bottom navigation for the field interface (D2 Step 3, D4 §5).
 *
 * Bottom rather than top because this is used one-handed on a phone, on site,
 * often in gloves. The bottom of the screen is where a thumb already is.
 *
 * Client component for the same reason the sidebar is: App Router layouts do
 * not re-render between their children, so a layout cannot know which route is
 * active. `usePathname` does.
 *
 * The safe-area padding is not decoration — without it the last item sits under
 * the home indicator on an iPhone and cannot be tapped at all.
 *
 * ---------------------------------------------------------------------------
 * SEVEN ITEMS ON A 375px SCREEN
 *
 * Four fitted comfortably. Seven do not: at 375px that is 53px each, and 53px
 * is under the 44px tap target once padding is taken off, with labels that
 * would have to be truncated to fit.
 *
 * So the bar SCROLLS sideways instead of shrinking. Each item keeps a fixed
 * minimum width wide enough for a gloved thumb and a readable label, and the
 * row scrolls when they do not all fit. On a wide phone nothing scrolls and it
 * looks exactly as it did; on a narrow one the last item is reachable rather
 * than merely present. Snap points stop it settling mid-item.
 * ---------------------------------------------------------------------------
 */

export interface FieldNavItem {
  href: string;
  label: string;
  icon: 'today' | 'tasks' | 'update' | 'docs' | 'photos' | 'issues' | 'punch' | 'messages';
  /** Unseen assignments. The "ding" in D4 §5. */
  badge?: number;
}

const ICONS: Record<FieldNavItem['icon'], React.ReactNode> = {
  today: <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
  tasks: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  update: <path d="M12 5v14M5 12h14" />,
  docs: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5" />,
  photos: <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />,
  issues: <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  punch: <path d="M9 11l3 3 8-8M3 6h6M3 12h4M3 18h8" />,
  messages: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 17 0z" />,
};

export function FieldNav({ items }: { items: FieldNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-navy-100 bg-white pb-[env(safe-area-inset-bottom)]"
      aria-label="Field navigation"
    >
      <ul className="mx-auto flex max-w-lg snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href} className="min-w-[4.25rem] flex-1 shrink-0 snap-start">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                // min-h-14 is the tap target. Anything smaller is a miss with a
                // work glove on.
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition ${
                  active ? 'text-navy-900' : 'text-navy-400'
                }`}
              >
                <span className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    {ICONS[item.icon]}
                  </svg>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="tabular absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-accent px-1 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </span>
                {item.label}
                {active && (
                  <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-navy-900" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Confirmation after a submit.
 *
 * D2 Step 3 asks for a clear success confirmation, and it matters more here than
 * anywhere else: on a bad signal a crew member who is not certain a form went
 * through will submit it again, and the PM gets the same update twice.
 */
export function FieldConfirmation({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-emerald-600/20 bg-emerald-50 px-4 py-3"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <p className="text-sm text-emerald-800">{children}</p>
    </div>
  );
}
