import { requireTenantScope } from '@/lib/scope';
import { getSession } from '@/lib/session';
import { getHubRecords, type ArchivedItem } from '@/lib/hub-db/records';
import { restoreArchivedItem } from '@/lib/actions';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';

/**
 * The Archive.
 *
 * Archiving without a screen that lists what was archived is a delete with
 * extra steps — the record survives in the database, but nobody can find it or
 * get it back without someone opening a SQL editor. This is the screen that
 * makes "archive, never delete" a real promise rather than a schema detail.
 *
 * Restore is one click and it is attributed, because the person who archived a
 * job by mistake is usually not the person who notices.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Archive</h1>
        <p className="mt-1 text-sm text-navy-400">
          Nothing here is deleted. Restore puts it back exactly where it was.
        </p>
      </div>
      {children}
    </div>
  );
}

export default async function Archive() {
  const scope = await requireTenantScope();
  const session = await getSession();
  const hub = getHubRecords();

  if (!hub.available) {
    return (
      <Shell>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">The Hub database isn&apos;t connected.</p>
          <p className="mt-1.5 text-xs text-navy-400">Missing: {hub.missing.join(', ')}</p>
        </Card>
      </Shell>
    );
  }

  if (scope.contractorId === undefined) {
    return (
      <Shell>
        <NotLinkedToContractor what="The archive" email={session?.email} />
      </Shell>
    );
  }

  let items: ArchivedItem[];
  try {
    items = await hub.records.listArchived(scope);
  } catch (error) {
    // Reported, never swallowed — an empty archive and a broken archive look
    // identical on screen, and only one of them means "you have nothing archived".
    return (
      <Shell>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t read the archive.</p>
          <p className="mt-1.5 text-xs text-navy-400">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </Card>
      </Shell>
    );
  }

  const byLabel = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.label] = (acc[item.label] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Shell>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(byLabel).map(([label, count]) => (
            <Badge key={label}>
              {label} · {count}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Archived"
          action={
            <span className="text-xs text-navy-400">
              {items.length === 0 ? 'nothing archived' : `${items.length} item${items.length === 1 ? '' : 's'}`}
            </span>
          }
        />
        <ul className="divide-y divide-navy-100">
          {items.map((item) => (
            <li key={`${item.table}-${item.id}`} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-navy-900">{item.title}</span>
                    <Badge>{item.label}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-navy-400">
                    Archived {shortDate(item.archivedAt.slice(0, 10))} by {item.archivedBy}
                    {item.reason !== null && item.reason !== '' && ` · ${item.reason}`}
                  </div>
                </div>

                <form action={restoreArchivedItem} className="shrink-0">
                  <input type="hidden" name="table" value={item.table} />
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="projectId" value={item.projectId} />
                  <button
                    type="submit"
                    className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Restore
                  </button>
                </form>
              </div>
            </li>
          ))}

          {items.length === 0 && (
            <li className="px-5 py-12 text-center">
              <p className="text-sm text-navy-600">Nothing has been archived.</p>
              <p className="mt-1.5 text-xs text-navy-400">
                Archived projects, milestones, tasks, updates, issues, documents and photos
                appear here — and can be restored from here.
              </p>
            </li>
          )}
        </ul>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        <strong className="font-semibold text-navy-600">Why nothing is ever deleted.</strong>{' '}
        The approval trail is what the privacy rules rest on — being able to say who published
        something, and when. A deleted row destroys that evidence. Archiving keeps the record
        and removes it from the working list, which is what {session?.name ?? 'a project manager'}{' '}
        actually wants when a job is done or was entered twice.
      </p>
    </Shell>
  );
}
