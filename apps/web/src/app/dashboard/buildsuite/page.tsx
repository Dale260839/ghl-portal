import { requireTenantScope } from '@/lib/scope';
import { getBuildSuiteReader } from '@/lib/buildsuite/projects';
import { getSession } from '@/lib/session';
import { Badge, Card, CardHeader, StatTile, shortDate } from '@/components/ui';

/**
 * Incoming from BuildSuite — the first screen in the Hub reading **live**
 * production data (D-009: straight from BuildSuite's Supabase, read-only).
 *
 * Everything else still runs on fixtures. This screen says so the other way
 * round: it is labelled live, because the interesting thing about it is that it
 * is not a demo.
 */
export default async function BuildSuiteProjects() {
  const reader = getBuildSuiteReader();
  const session = await getSession();

  // Tenancy: a session with no auth profile can read nothing. Failing closed
  // matters here — the fallback for a missing tenant filter is every
  // contractor's projects, which is the bug this guard exists to prevent.
  if (session?.authProfileIds === undefined || session.authProfileIds.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">
          Incoming from BuildSuite
        </h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">
            This account isn&apos;t linked to a BuildSuite profile.
          </p>
          <p className="mt-1.5 text-xs text-navy-400">
            Projects are scoped per contractor, so there is nothing to show.
          </p>
        </Card>
      </div>
    );
  }
  const scope = await requireTenantScope();

  if (!reader.available) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">
          Incoming from BuildSuite
        </h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">Not connected to BuildSuite.</p>
          <p className="mt-1.5 text-xs text-navy-400">
            Missing: {reader.missing.join(', ')}
          </p>
        </Card>
      </div>
    );
  }

  let projects;
  let counts: Record<string, number> = {};
  try {
    [projects, counts] = await Promise.all([
      reader.listActiveProjects(scope, 50),
      reader.countByStatus(scope),
    ]);
  } catch (error) {
    // A read failure is reported, never papered over with fixtures — a screen
    // that silently swaps live data for samples is worse than one that errors.
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">
          Incoming from BuildSuite
        </h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t read BuildSuite.</p>
          <p className="mt-1.5 text-xs text-navy-400">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </Card>
      </div>
    );
  }

  const linked = projects.filter((p) => p.linkedToGhl).length;

  return (
    <div className="space-y-7">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">
            Incoming from BuildSuite
          </h1>
          <Badge tone="good">Live data</Badge>
        </div>
        <p className="mt-1 text-sm text-navy-400">
          Read directly from BuildSuite&apos;s database, read-only. {projects.length} active
          projects.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(['active', 'matched', 'new', 'draft', 'completed'] as const).map((status) => (
          <StatTile
            key={status}
            label={status}
            value={String(counts[status] ?? 0)}
            tone={status === 'active' ? 'good' : 'default'}
          />
        ))}
      </div>

      <Card>
        <CardHeader
          title="Active projects"
          action={
            <span className="text-xs text-navy-400">
              {linked} of {projects.length} linked to GHL
            </span>
          }
        />
        <ul className="divide-y divide-navy-100">
          {projects.map((project) => (
            <li key={project.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-navy-900">{project.title}</div>
                  <div className="mt-0.5 truncate text-xs text-navy-400">
                    {project.clientName}
                    {project.address === '' ? '' : ` · ${project.address}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge>{project.source}</Badge>
                  {project.linkedToGhl ? (
                    <Badge tone="good">In GHL</Badge>
                  ) : (
                    <Badge tone="warn">Not in GHL</Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-navy-400">
                <span>{project.trade}</span>
                <span>{project.projectType}</span>
                <span className="tabular">{project.budget}</span>
                {project.updatedAt !== null && (
                  <span>updated {shortDate(project.updatedAt.slice(0, 10))}</span>
                )}
              </div>
            </li>
          ))}
          {projects.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-navy-400">
              No active projects in BuildSuite.
            </li>
          )}
        </ul>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        <strong className="font-semibold text-navy-600">On the identifiers.</strong>{' '}
        BuildSuite has no <code>BSP-YYYY-NNNNNN</code> column — projects link to GHL by{' '}
        <code>ghl_opportunity_id</code> and <code>ghl_contact_id</code>. &ldquo;Not in GHL&rdquo;
        means a project has no GHL counterpart yet, so nothing downstream can join to it.
      </p>
    </div>
  );
}
