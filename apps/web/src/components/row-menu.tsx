'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * The ⋮ on a project row, made real.
 *
 * The mockup showed a row menu; a button that does nothing reads as broken the
 * first time somebody clicks it in a walkthrough. This opens the three things a
 * PM actually wants from a row: the project's workspace, the client's view of
 * it, and its visibility switches. Closes on outside click and Escape, the same
 * way the header menus do.
 */
export function RowMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
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

  const items = [
    { href: `/dashboard/projects/${projectId}`, label: 'Open workspace' },
    { href: `/portal?preview=${projectId}`, label: 'Preview client view' },
    { href: `/dashboard/projects/${projectId}/visibility`, label: 'Visibility settings' },
  ];

  return (
    <div ref={root} className="relative hidden justify-self-end sm:block">
      <button
        type="button"
        aria-label="Project actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={`press flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
          open ? 'bg-navy-100 text-navy-900' : 'text-navy-400 hover:bg-navy-50 hover:text-navy-700'
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="menu-enter absolute right-0 z-30 mt-1.5 w-52 overflow-hidden rounded-lg border border-navy-100 bg-white py-1 shadow-[0_1px_2px_rgba(10,31,68,0.06),0_12px_28px_-14px_rgba(10,31,68,0.28)]"
        >
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
