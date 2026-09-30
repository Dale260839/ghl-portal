import { NextResponse, type NextRequest } from 'next/server';

import { getSession } from '@/lib/session';
import { actionTenantScope } from '@/lib/scope';
import { getHubStorage } from '@/lib/hub-db/storage';
import { getHubMedia, type MediaKind } from '@/lib/hub-db/media';
import { currentPortalProject, documentsFor, photosFor } from '@/lib/portal-data';
import { hubScopeOfProject } from '@/lib/tenant-scope';
import { currentAccess } from '@/lib/access';
import { currentDataSource } from '@/lib/data/current-source';
import { fieldProjectsFor } from '@/lib/field-scope';
import { isFieldFolder } from '@/lib/document-folders';
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

/**
 * Whether a crew member may be handed this file.
 *
 * Contractors are unrestricted within their own tenant, which is what the
 * scope already proves. A crew member is restricted twice over, exactly as
 * their screens are:
 *
 *   · the file must be on a project they are assigned to;
 *   · a document must be in a **field folder**. The Client folder and the
 *     contractor's own filing — signed contracts, letterheads — are not
 *     theirs, released or not.
 *
 * Photos are allowed on an assigned project regardless of release state: a
 * crew member took most of them, and the release flag is about the homeowner.
 */
async function fieldMaySee(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  item: { projectId: string; category: string },
  kind: MediaKind,
): Promise<boolean> {
  if (session.role !== 'field') return true;

  if (kind === 'document' && !isFieldFolder(item.category)) return false;

  const access = await currentAccess();
  if (!access.ok) return false;

  const scope = await actionTenantScope(session);
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  return fieldProjectsFor(access.access, projects, tasks).some(
    (p) => p.buildsuiteProjectId === item.projectId,
  );
}

/**
 * The project rule, applied to a raw storage path.
 *
 * A path is `contractorId/projectId/kind/uuid-filename`, so the project is the
 * second segment. A path shaped differently is refused rather than guessed at:
 * this decides access, and a path we cannot read is one we cannot check.
 */
async function fieldMayReachPath(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  path: string,
): Promise<boolean> {
  const projectId = path.split('/')[1] ?? '';
  if (projectId.trim() === '') return false;

  const access = await currentAccess();
  if (!access.ok) return false;

  const scope = await actionTenantScope(session);
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  return fieldProjectsFor(access.access, projects, tasks).some(
    (p) => p.buildsuiteProjectId === projectId,
  );
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
    //
    // ── AND, FOR A CREW MEMBER, TO WHAT THEY MAY ACTUALLY SEE ─────────────
    //
    // Found 2026-09-30. The tenant filter below is the only thing this route
    // checked, so a crew member holding any document id belonging to their
    // contractor could fetch it: a signed contract with its pricing, a file on
    // a project they were never assigned, a document in the Client folder.
    //
    // Their own screens enforce both rules — `fieldProjectsFor` for the
    // project, and field folders only for documents — but a screen is not a
    // permission. Ids are uuids so this was not enumerable, which makes it the
    // quiet kind: a link that keeps working after somebody is taken off a job.
    const media = getHubMedia();
    if (!media.available) {
      return NextResponse.json({ error: 'file storage is not connected' }, { status: 503 });
    }
    try {
      const scope = await actionTenantScope(session);
      const item = await media.media.getById(scope, kind, id);
      if (item === null) return NextResponse.json({ error: 'not found' }, { status: 404 });
      if (!(await fieldMaySee(session, item, kind))) {
        // The same answer an id that does not exist gets. Telling a crew member
        // that a document exists but is not theirs is itself a disclosure.
        return NextResponse.json({ error: 'not found' }, { status: 404 });
      }
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
    // The same restriction as the id branch, read out of the path itself:
    // `contractorId/projectId/kind/uuid-filename`. `signedUrl` already refuses
    // another contractor's prefix; this is the project rule a crew member is
    // held to everywhere else.
    if (session.role === 'field' && !(await fieldMayReachPath(session, path))) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const url = await storage.storage.signedUrl(scope, path);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
