import type { Project } from './data/types.ts';

/**
 * Which project code a screen shows (Sing, 2026-09-12).
 *
 * One `projects` row carries both codes, and nothing moves when a project is
 * awarded:
 *
 *   project_code  the CLIENT's code, and the project's permanent identity
 *   award_code    the WINNING contractor's code — empty on a project the
 *                 contractor created themselves, where project_code already is
 *                 their code
 *
 * ---------------------------------------------------------------------------
 * THE TWO VIEWS
 *
 *   CONTRACTOR  COALESCE(award_code, project_code), with project_code shown as
 *               the client reference when the two differ.
 *                 BSA-053  ->  BSA-APS-003 · client ref BSA-053
 *                 BSA-APS-001 (self-created) -> BSA-APS-001, nothing else
 *
 *   CLIENT      project_code, always. It is what the signature automation
 *               emails the homeowner, what they sign in with, and what their
 *               invoices carry. A homeowner never sees an award code.
 *
 * Both functions live here so no screen writes the COALESCE its own way.
 * ---------------------------------------------------------------------------
 */

type Codes = Pick<Project, 'projectCode'> & { awardCode?: string | null };

function present(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

/** The code a CONTRACTOR sees: `COALESCE(award_code, project_code)`. */
export function contractorCode(project: Codes): string | null {
  return present(project.awardCode) ?? present(project.projectCode);
}

/**
 * The client's code, shown beside the contractor's — ONLY when the two differ.
 *
 * Null on a self-created project, where they are the same code, so a contractor
 * is not shown "BSA-APS-001 · client ref BSA-APS-001".
 */
export function clientReference(project: Codes): string | null {
  const shown = contractorCode(project);
  const client = present(project.projectCode);
  return client !== null && client !== shown ? client : null;
}

/** The code a CLIENT sees. Never the award code. */
export function clientCode(project: Pick<Project, 'projectCode'>): string | null {
  return present(project.projectCode);
}
