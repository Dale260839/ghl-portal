'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';

import { portalHref } from '@/lib/portal-link';

/**
 * A portal link that stays on the project being shown.
 *
 * For links rendered by a SERVER component — the portal layout's header, which
 * cannot read the query string. The nav does this itself; this is for the one
 * or two links outside it, starting with the change-order bell, which was still
 * dropping `?preview=` after the nav was fixed.
 */
export function PortalLink({
  href,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const search = useSearchParams();
  return <Link href={portalHref(href, search)} {...rest} />;
}

/**
 * The way out of a contractor's preview — back to the project they came from.
 *
 * Chris, huddle 2026-09-10: "returning to dashboard works", but the preview
 * should feel seamless within the project. The exit went to `/dashboard`, the
 * top of everything, so a contractor checking one project's client view lost
 * their place every time. It returns to that project's own page now, and to
 * the dashboard only when there is no project to return to.
 *
 * The id is only placed in a link. `/dashboard/projects/[id]` reads the project
 * through the contractor's own tenant scope, so a value edited into the address
 * bar reaches nothing it could not reach already.
 */
export function PreviewExitLink({ className }: { className?: string }) {
  const preview = useSearchParams()?.get('preview')?.trim() ?? '';
  const href = preview === '' ? '/dashboard' : `/dashboard/projects/${encodeURIComponent(preview)}`;
  return (
    <Link href={href} className={className}>
      {preview === '' ? '← Back to dashboard' : '← Back to project'}
    </Link>
  );
}
