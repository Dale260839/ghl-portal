'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PROJECTS_LIST, sectionFromPath, sectionLabel } from '@/lib/project-nav';

/**
 * Where you are, in three steps: the list, this project, this section.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LAYOUT CANNOT DO THIS ITSELF
 *
 * The project workspace layout knows the project — it fetched it. What it does
 * not know is the section, because an App Router layout is not re-rendered when
 * you move between its children and is never handed the path. So the project's
 * identity comes in as props from the server, and the section is read here.
 *
 * The context bar above still names the company, deliberately. A contractor
 * operating across sub-accounts needs all three facts at once — which company,
 * which project, which section — and they read top to bottom.
 * ---------------------------------------------------------------------------
 */
export function ProjectBreadcrumb({ code }: { code: string }) {
  const pathname = usePathname();
  const section = sectionLabel(sectionFromPath(pathname));

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-navy-400">
        <li>
          <Link href={PROJECTS_LIST} className="font-medium hover:text-navy-600 hover:underline">
            Projects
          </Link>
        </li>
        <li aria-hidden="true" className="text-navy-200">
          /
        </li>
        {/* The code, not the name. It is what appears on the paperwork and in
            the client's inbox, and it is short enough not to wrap on a phone. */}
        <li className="font-medium text-navy-500">{code}</li>
        {section !== null && section !== 'Overview' && (
          <>
            <li aria-hidden="true" className="text-navy-200">
              /
            </li>
            {/* The page you are on: marked current, and not a link to itself. */}
            <li aria-current="page" className="font-medium text-navy-900">
              {section}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
