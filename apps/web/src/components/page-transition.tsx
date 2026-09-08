'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Plays the route entrance on every navigation.
 *
 * The shell persists across navigations (that is the point of a layout), so an
 * animation on it would run once and never again. Keying this wrapper on the
 * pathname remounts it per route, and `.enter` settles the new content in with
 * a short fade and rise. It is the difference between a screen that appears and
 * one that arrives.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="enter">
      {children}
    </div>
  );
}
