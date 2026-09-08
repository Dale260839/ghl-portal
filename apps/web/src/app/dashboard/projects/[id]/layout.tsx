import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { hasOperationalDetail } from '@/lib/data/types';
import { HealthBadge } from '@/components/ui';
import { ProjectTabs } from '@/components/project-tabs';

/**
 * The per-project control workspace.
 *
 * Everything the client sees has a twin here, and a few things only the
 * contractor gets. The header names the project once; the tab strip carries the
 * screens. Each child page is a control surface for one of them — it shows the
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
        <Link
          href="/dashboard/projects"
          className="text-xs font-medium text-navy-400 hover:underline"
        >
          ← Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">
            {project.projectName}
          </h1>
          {hasOperationalDetail(project) && <HealthBadge status={project.healthStatus} />}
        </div>
        <p className="mt-1 text-sm text-navy-400">
          {project.projectAddress} · {project.buildsuiteProjectId}
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-navy-400">
          Your control centre for this project. You create and manage every screen here; the client
          sees only what you release. Fields marked internal never reach them.
        </p>
      </div>

      <ProjectTabs id={project.buildsuiteProjectId} />

      {children}
    </div>
  );
}
