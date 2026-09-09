import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { getHubMedia, type MediaItem } from '@/lib/hub-db/media';
import { Card, shortDate } from '@/components/ui';

/**
 * Site documents (D4 §5).
 *
 * ---------------------------------------------------------------------------
 * WHICH FILES REACH A PHONE
 *
 * Folders are encoded in `hub_documents.category`: exactly `Client` for the
 * folder a homeowner is served from, or `Field · <Trade>` for the ones the crew
 * works out of. This screen shows the `Field` folders and nothing else.
 *
 * That is deliberately NOT the same rule as the client gate. A crew member is
 * inside the company, so `client_visible` is not what decides here — the folder
 * is. A drawing can be internal and still be exactly the thing the person
 * standing on the slab needs. What they must not get is the client folder,
 * which is where contracts and signed paperwork live.
 *
 * Read only. Nothing on this screen uploads, renames or releases a file; the
 * office owns the filing.
 * ---------------------------------------------------------------------------
 */

const FIELD_PREFIX = 'Field';

/** `Field · Electrical` → `Electrical`. A bare `Field` folder reads as General. */
function tradeOf(category: string): string {
  const rest = category.slice(FIELD_PREFIX.length).replace(/^[\s·|/-]+/, '').trim();
  return rest === '' ? 'General' : rest;
}

function isFieldFolder(category: string): boolean {
  return category.trim().toLowerCase().startsWith(FIELD_PREFIX.toLowerCase());
}

export default async function FieldDocuments() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  // A session that resolves to no contractor record has nothing to read: every
  // Hub row is filed under one, and `assertContractor` rightly throws rather
  // than falling back to another id. Say so plainly — a stack trace tells a
  // person on a job site nothing they can act on.
  if (scope.contractorId === undefined) {
    return (
      <Card className="px-4 py-8 text-center">
        <p className="text-sm text-navy-400">
          Your account is not linked to a company yet. Ask your PM to check your invitation.
        </p>
      </Card>
    );
  }

  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  // §9.4 — only projects this person is on, with every money field already
  // dropped by `projectsForField`.
  const mine = fieldProjectsFor(await requireAccess(), projects, tasks);

  const hub = getHubMedia();
  const byProject: { projectId: string; projectName: string; trades: [string, MediaItem[]][] }[] =
    [];

  if (hub.available) {
    for (const project of mine) {
      const all = await hub.media.listForProject(
        scope,
        'document',
        project.buildsuiteProjectId,
      );
      const trades = new Map<string, MediaItem[]>();
      for (const item of all) {
        if (!isFieldFolder(item.category)) continue;
        const trade = tradeOf(item.category);
        const bucket = trades.get(trade);
        if (bucket === undefined) trades.set(trade, [item]);
        else bucket.push(item);
      }
      if (trades.size === 0) continue;
      byProject.push({
        projectId: project.buildsuiteProjectId,
        projectName: project.projectName,
        trades: [...trades.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      });
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Site documents</h1>
        <p className="mt-1 text-sm text-navy-400">
          Drawings, permits and specs filed for your trades.
        </p>
      </div>

      {!hub.available ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            Documents are not available right now. Ask your PM to check the connection.
          </p>
        </Card>
      ) : byProject.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            No site documents yet. Your PM files drawings and permits here.
          </p>
        </Card>
      ) : (
        byProject.map((group) => (
          <section key={group.projectId} className="space-y-3">
            <h2 className="text-sm font-semibold text-navy-900">{group.projectName}</h2>

            {group.trades.map(([trade, items]) => (
              <Card key={trade} className="px-4 py-4">
                <div className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                  {trade}
                </div>
                <ul className="mt-2 space-y-2">
                  {items.map((item) => (
                    <li key={item.id}>
                      {item.externalUrl !== null ? (
                        <a
                          href={item.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block min-h-11 rounded-lg border border-navy-100 px-3 py-2.5 text-sm font-medium text-navy-800 transition hover:bg-navy-50"
                        >
                          {item.label || 'Untitled document'}
                          <span className="block text-xs font-normal text-navy-400">
                            Link · {shortDate(item.createdAt)}
                          </span>
                        </a>
                      ) : item.storagePath !== null ? (
                        // The bucket is private, so this goes through the route
                        // that mints a short-lived signed URL rather than a
                        // permanent link that could be forwarded anywhere.
                        <a
                          href={`/api/files?path=${encodeURIComponent(item.storagePath)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block min-h-11 rounded-lg border border-navy-100 px-3 py-2.5 text-sm font-medium text-navy-800 transition hover:bg-navy-50"
                        >
                          {item.label || 'Untitled document'}
                          <span className="block text-xs font-normal text-navy-400">
                            File · {shortDate(item.createdAt)}
                          </span>
                        </a>
                      ) : (
                        <span className="block rounded-lg border border-dashed border-navy-100 px-3 py-2.5 text-sm text-navy-400">
                          {item.label || 'Untitled document'} · no file attached
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </section>
        ))
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        You see the folders filed for the field. Client paperwork and anything with pricing on it is
        not part of this view.
      </p>
    </div>
  );
}
