import { clientReference, contractorCode, UNLISTED_PROJECT } from '@/lib/project-codes';
import type { Project } from '@/lib/data/types';

/**
 * A project's code as a CONTRACTOR reads it (Sing, 2026-09-12).
 *
 *   BSA-053      ->  BSA-APS-003 · client ref BSA-053
 *   BSA-APS-001  ->  BSA-APS-001
 *   no code yet  ->  No project code yet
 *
 * The client reference is shown because it is the code the homeowner holds —
 * the one they sign in with and read off their invoices — so a contractor on
 * the phone with them can match it.
 *
 * Contractor screens only. Client screens show `projectCode` directly and must
 * never render this component: it is the one place an award code is printed.
 */
export function ContractorProjectCode({
  project,
}: {
  project: Pick<Project, 'projectCode'> & { awardCode?: string | null };
}) {
  const code = contractorCode(project);
  const ref = clientReference(project);

  if (code === null) return <span className="italic">No project code yet</span>;
  return (
    <>
      <span className="font-medium tracking-wide text-navy-500">{code}</span>
      {ref !== null && <span className="text-navy-400"> · client ref {ref}</span>}
    </>
  );
}

/**
 * A project named in a list row on a contractor or crew screen: its name and
 * its contractor code — "Handyman / Small Repairs · BSA-APS-003 · client ref
 * BSA-053". A project the screen cannot find reads "Unlisted project", never
 * its id.
 */
export function ContractorProjectRef({
  project,
}: {
  project: (Pick<Project, 'projectName' | 'projectCode'> & { awardCode?: string | null }) | undefined | null;
}) {
  if (project === undefined || project === null) {
    return <span className="italic">{UNLISTED_PROJECT}</span>;
  }
  return (
    <>
      {project.projectName} · <ContractorProjectCode project={project} />
    </>
  );
}
