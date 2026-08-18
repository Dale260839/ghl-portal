import Link from 'next/link';
import { getDataSource } from '@/lib/data/source';
import { requireTenantScope } from '@/lib/scope';
import { Badge, Card, HealthBadge, ProgressBar, currency, shortDate } from '@/components/ui';

export default async function ProjectsList() {
  const scope = await requireTenantScope();
  const projects = await getDataSource(scope).listProjects(scope);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Projects</h1>
        <p className="mt-1 text-sm text-navy-400">
          {projects.length} projects · every row keyed by its BuildSuite Project ID
        </p>
      </div>

      <Card className="overflow-hidden">
        {/* Desktop table */}
        <table className="hidden w-full text-left md:table">
          <thead>
            <tr className="border-b border-navy-100 bg-navy-50/60 text-xs tracking-wide text-navy-400 uppercase">
              <th className="px-5 py-2.5 font-medium">Project</th>
              <th className="px-5 py-2.5 font-medium">Stage</th>
              <th className="w-44 px-5 py-2.5 font-medium">Progress</th>
              <th className="px-5 py-2.5 text-right font-medium">Contract</th>
              <th className="px-5 py-2.5 font-medium">Health</th>
              <th className="px-5 py-2.5 font-medium">Portal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-100">
            {projects.map((p) => (
              <tr key={p.buildsuiteProjectId} className="transition hover:bg-navy-50/60">
                <td className="px-5 py-3.5">
                  <Link
                    href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                    className="text-sm font-medium text-navy-900 hover:underline"
                  >
                    {p.projectName}
                  </Link>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {p.clientName} · {p.buildsuiteProjectId}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-navy-600">{p.projectStage}</td>
                <td className="px-5 py-3.5">
                  <ProgressBar value={p.progressPercentage} />
                </td>
                <td className="tabular px-5 py-3.5 text-right text-sm text-navy-900">
                  {currency(p.currentProjectTotal)}
                </td>
                <td className="px-5 py-3.5">
                  <HealthBadge status={p.healthStatus} />
                </td>
                <td className="px-5 py-3.5">
                  {p.clientPortalEnabled ? (
                    <Badge tone="good">Enabled</Badge>
                  ) : (
                    <Badge>Off</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile cards */}
        <ul className="divide-y divide-navy-100 md:hidden">
          {projects.map((p) => (
            <li key={p.buildsuiteProjectId}>
              <Link
                href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                className="block px-5 py-4 transition hover:bg-navy-50/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-navy-900">
                      {p.projectName}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {p.clientName} · {p.projectStage}
                    </div>
                  </div>
                  <HealthBadge status={p.healthStatus} />
                </div>
                <div className="mt-3">
                  <ProgressBar value={p.progressPercentage} />
                </div>
                <div className="tabular mt-2 text-xs text-navy-400">
                  {currency(p.currentProjectTotal)} · due {shortDate(p.estimatedCompletionDate)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
