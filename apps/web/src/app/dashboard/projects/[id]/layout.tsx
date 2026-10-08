import { ContractorProjectCode } from '@/components/project-code';
import { ProjectBreadcrumb } from '@/components/project-breadcrumb';
import { contractorCode } from '@/lib/project-codes';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { hasOperationalDetail } from '@/lib/data/types';
import { HealthBadge } from '@/components/ui';

/**
 * The per-project control workspace.
 *
 * Everything the client sees has a twin here, and a few things only the
 * contractor gets. A breadcrumb says where you are, the header names the project
 * once. Each child page is a control surface for one of them — it shows the
 * whole picture, including what is held back from the client, because this is
 * where a PM decides what to release.
 */
export default async function ProjectWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  return (
    <div className="space-y-6">
      <div>
        {/* Replaces a bare "← Projects". That answered how to get back out and
            nothing else; a contractor eleven sections deep could not tell from
            the top of the screen which section they were in, only from which
            row happened to be lit in the sidebar. */}
        <ProjectBreadcrumb code={contractorCode(project) ?? 'No project code'} />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">
            {project.projectName}
          </h1>
          {hasOperationalDetail(project) && <HealthBadge status={project.healthStatus} />}
        </div>
        <p className="mt-1 text-sm text-navy-400">
          {/* Was the UUID. The contractor's code instead, with the client's
              beside it when they differ (Sing, 2026-09-12). */}
          {project.projectAddress} · <ContractorProjectCode project={project} />
        </p>
      </div>

      {/* No tab strip (John, 2026-09-15). The project's sections live under
          "Projects" in the sidebar, which follows this project; a second copy
          of the same fifteen links across the top was the same menu twice. */}

      {children}
    </div>
  );
}
