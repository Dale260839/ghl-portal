import { NextResponse, type NextRequest } from 'next/server';

/**
 * Puts the request path into a header so server layouts can read it.
 *
 * Next.js deliberately doesn't expose the pathname to a layout — layouts don't
 * re-render on navigation between their children, so a layout that read the path
 * directly would go stale. Passing it through a header is the supported way, and
 * the sidebar needs it to know which item is active.
 */
export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Skip static assets and images — they don't render a layout, so tagging them
  // is pure overhead on every request.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
