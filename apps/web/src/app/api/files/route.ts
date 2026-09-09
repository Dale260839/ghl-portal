import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { actionTenantScope } from '@/lib/scope';
import { getHubStorage } from '@/lib/hub-db/storage';

/**
 * Open a stored file.
 *
 * ---------------------------------------------------------------------------
 * WHY A ROUTE AND NOT A LINK TO STORAGE
 *
 * The `hub-media` bucket is private, so no object is reachable by URL alone.
 * That is the whole point: a public bucket hands out permanent unguessable
 * URLs, and unguessable is not a permission — a link that leaks stays valid
 * forever and cannot be revoked. We already have one live example of that
 * failure mode in `proposals.signed_pdf_url`.
 *
 * So this mints a SHORT-LIVED signed URL, and only after establishing that the
 * caller is the contractor whose prefix the path sits under. `signedUrl` checks
 * that prefix itself, so a path belonging to another tenant fails there even if
 * this route were reached.
 *
 * Redirects rather than proxying the bytes: the file goes straight from
 * Supabase to the browser, and nothing large passes through the app.
 * ---------------------------------------------------------------------------
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (path.trim() === '') {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  const storage = getHubStorage();
  if (!storage.available) {
    return NextResponse.json(
      { error: `file storage is not connected (missing ${storage.missing.join(', ')})` },
      { status: 503 },
    );
  }

  try {
    const scope = await actionTenantScope(session);
    const url = await storage.storage.signedUrl(scope, path);
    return NextResponse.redirect(url);
  } catch {
    // A path outside this contractor's prefix, a file since removed, or a
    // session with no tenant. All three are "not yours", and saying which
    // would tell a caller whether the file exists.
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
