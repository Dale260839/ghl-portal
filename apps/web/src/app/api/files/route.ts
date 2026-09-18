import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { actionTenantScope } from '@/lib/scope';
import { getHubStorage } from '@/lib/hub-db/storage';
import { getHubMedia, type MediaKind } from '@/lib/hub-db/media';
import { currentPortalProject, documentsFor, photosFor } from '@/lib/portal-data';
import { hubScopeOfProject } from '@/lib/tenant-scope';
import type { TenantScope } from '@/lib/tenancy';

/**
 * Serving a stored file.
 *
 * ---------------------------------------------------------------------------
 * TWO WAYS IN, AND WHY THERE ARE TWO
 *
 * `?path=` is the contractor and crew route: the path begins with their
 * contractor id and `signedUrl` refuses anything that does not, so knowing a
 * path is not enough to read another tenant's file.
 *
 * `?id=&kind=` names a ROW, which is what carries `client_visible` and the
 * project the §9.1 gates are asked about. A homeowner holds no tenant scope, so
 * the path route can never serve them — until 2026-09-18 that meant a released
 * photo showed a grey placeholder and a released document had no link at all.
 * Here their own projects are read through the same gates the portal screens
 * use, and a file that is not released simply is not found.
 * ---------------------------------------------------------------------------
 */

function isKind(value: string | null): value is MediaKind {
  return value === 'photo' || value === 'document';
}

async function signedFor(storagePath: string, scope: TenantScope): Promise<string | null> {
  const storage = getHubStorage();
  if (!storage.available) return null;
  return storage.storage.signedUrl(scope, storagePath);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (session === null) {
    return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  }

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  const kind = request.nextUrl.searchParams.get('kind');
  const path = request.nextUrl.searchParams.get('path') ?? '';

  if (id !== '') {
    if (!isKind(kind)) {
      return NextResponse.json({ error: 'kind must be photo or document' }, { status: 400 });
    }

    // ── A homeowner: their own projects, through the portal's gates ────────
    if (session.role === 'client') {
      try {
        const { allProjects } = await currentPortalProject({});
        for (const project of allProjects) {
          const files = kind === 'photo' ? await photosFor(project) : await documentsFor(project);
          const match = files.find((f) => f.id === id);
          if (match === undefined) continue;
          if (match.externalUrl !== null) return NextResponse.redirect(match.externalUrl);
          if (match.storagePath === null) break;
          const scope = await hubScopeOfProject(project);
          if (scope === null) break;
          const url = await signedFor(match.storagePath, scope);
          if (url !== null) return NextResponse.redirect(url);
        }
      } catch {
        // Fall through to the same answer an unreleased file gets.
      }
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // ── A contractor or crew member: the row, filtered to their tenant ─────
    const media = getHubMedia();
    if (!media.available) {
      return NextResponse.json({ error: 'file storage is not connected' }, { status: 503 });
    }
    try {
      const scope = await actionTenantScope(session);
      const item = await media.media.getById(scope, kind, id);
      if (item === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (item.externalUrl !== null) return NextResponse.redirect(item.externalUrl);
      if (item.storagePath === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
      const url = await signedFor(item.storagePath, scope);
      if (url === null) {
        return NextResponse.json({ error: 'file storage is not connected' }, { status: 503 });
      }
      return NextResponse.redirect(url);
    } catch {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
  }

  if (path.trim() === '') {
    return NextResponse.json({ error: 'path or id is required' }, { status: 400 });
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
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
