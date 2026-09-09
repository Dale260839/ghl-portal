'use server';

import { revalidatePath } from 'next/cache';

import { requireAccess, type Access } from '../access.ts';
import { assertCan } from '../permissions.ts';
import { actionTenantScope } from '../scope.ts';
import { currentDataSource } from '../data/current-source.ts';
import { fieldProjectsFor } from '../field-scope.ts';
import {
  getHubOperational,
  HubOperational,
  ISSUE_STATUS_FOR_PUNCH,
  ISSUE_STATUSES,
  PUNCH_CATEGORY,
} from '../hub-db/operational.ts';
import type { Issue, PunchListItem } from '../data/types.ts';
import type { TenantScope } from '../tenancy.ts';

/**
 * Issues and the punch list — the write paths.
 *
 * ---------------------------------------------------------------------------
 * A NEW FILE RATHER THAN MORE OF `actions.ts`
 *
 * `actions.ts` is 1,449 lines and every screen imports it, so a change to the
 * issue rules re-renders the reasoning for invoicing, sign-in and team
 * invitations alongside it. These seven actions share one resource, one table
 * and one set of gates; keeping them together is what makes the field/contractor
 * asymmetry below readable in one sitting.
 *
 * ---------------------------------------------------------------------------
 * THREE GATES ON EVERY WRITE, IN THIS ORDER
 *
 *   1. `assertCan(role, action, resource)` — the permission matrix. The button
 *      being hidden is a UI fact; a server action is something anyone can post
 *      to, so the role is checked here regardless.
 *   2. **Project membership** for a field user. The matrix says "a crew member
 *      may update an issue"; `assertOnProject` says "may they update one on
 *      THIS project". Both have to pass, and conflating them is how a crew
 *      member ends up closing snags on a job they were never sent to.
 *   3. The tenant filter on the row itself, inside `HubOperational`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FIELD MAY NOT DO
 *
 * Release anything. `client_visible` is written by exactly two actions here,
 * `releaseIssue` and `releasePunchItem`, both contractor-only, and neither
 * `raiseIssue` nor `addPunchItem` reads a release flag off the form at all — so
 * a crafted POST has nothing to set. That is §10 in its most literal form:
 * nothing the crew writes reaches a homeowner until a person decides it should.
 *
 * A crew member also cannot mark a snag Verified. Verification is the office
 * signing off on the crew's own work, and a role that can verify itself is not
 * a check. They may take an item as far as Completed and no further.
 * ---------------------------------------------------------------------------
 */

interface IssueContext {
  access: Access;
  scope: TenantScope;
  ops: HubOperational;
}

async function issueContext(): Promise<IssueContext> {
  const access = await requireAccess();

  const hub = getHubOperational();
  if (!hub.available) {
    throw new Error(`the Hub database is not connected (missing ${hub.missing.join(', ')})`);
  }
  return { access, scope: await actionTenantScope(access.session), ops: hub.ops };
}

/**
 * A field user may only act on a project they are actually on.
 *
 * A contractor passes straight through: `access.projectIds === null` means
 * nothing narrows them, and every read is already filtered to their tenant.
 */
async function assertOnProject(
  access: Access,
  scope: TenantScope,
  projectId: string,
): Promise<void> {
  if (access.role === 'contractor' && access.projectIds === null) return;

  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(access, projects, tasks);

  if (!mine.some((p) => p.buildsuiteProjectId === projectId)) {
    throw new Error('you are not on this project');
  }
}

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? '').trim();
  if (value === '') throw new Error(`${key} is required`);
  return value;
}

function optionalDate(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? '').trim();
  return value === '' ? null : value;
}

function issueStatusFrom(value: string): Issue['status'] {
  const match = ISSUE_STATUSES.find((s) => s === value);
  if (match === undefined) throw new Error(`unknown issue status: ${value}`);
  return match;
}

/** Both screens revalidate together — the same rows drive both. */
function revalidateIssue(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/issues`);
  revalidatePath('/field/issues');
}

function revalidatePunch(projectId: string): void {
  revalidatePath(`/dashboard/projects/${projectId}/completion`);
  revalidatePath('/field/punch');
  revalidatePath('/portal/completion');
}

// ── Issues ──────────────────────────────────────────────────────────────────

/**
 * Raise an issue. Contractor or field.
 *
 * Note what is NOT read from the form: `clientVisible` and `clientUpdate`. A
 * new issue is internal, and the release is a separate contractor decision.
 */
export async function raiseIssue(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'create', 'issue');

  const projectId = required(formData, 'projectId');
  await assertOnProject(access, scope, projectId);

  await ops.createIssue(scope, {
    projectId,
    issueTitle: required(formData, 'issueTitle'),
    category: String(formData.get('category') ?? '') || 'Other',
    description: String(formData.get('description') ?? ''),
    projectArea: String(formData.get('projectArea') ?? ''),
    priority: formData.get('priority') === 'Urgent' ? 'Urgent' : 'Normal',
    targetResolutionDate: optionalDate(formData, 'targetResolutionDate'),
    // The crew's own note. Internal to the company, which includes the crew —
    // it is the CLIENT this is kept from, and the client projection in
    // `portal-gates.ts` drops it by construction.
    internalNotes: String(formData.get('internalNotes') ?? ''),
    raisedBy: access.session.name,
    raisedByRole: access.role,
  });

  revalidateIssue(projectId);
}

/**
 * Move an issue along. A contractor may also set the assignee, the target date
 * and the internal note in the same save; a field user may set the status and
 * nothing else, on a project they are on.
 */
export async function updateIssueStatus(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'update', 'issue');

  const issueId = required(formData, 'issueId');
  const projectId = required(formData, 'projectId');
  await assertOnProject(access, scope, projectId);

  const status = issueStatusFrom(required(formData, 'status'));

  if (access.role === 'contractor') {
    await ops.updateIssue(scope, issueId, {
      status,
      assignedTo: String(formData.get('assignedTo') ?? '').trim() || null,
      priority: formData.get('priority') === 'Urgent' ? 'Urgent' : 'Normal',
      internalNotes: String(formData.get('internalNotes') ?? ''),
      clientUpdate: String(formData.get('clientUpdate') ?? ''),
      resolution: String(formData.get('resolution') ?? ''),
      targetResolutionDate: optionalDate(formData, 'targetResolutionDate'),
    });
  } else {
    // Status only. Every other key on the form is ignored rather than trusted,
    // so a crafted POST carrying `clientUpdate` writes nothing.
    await ops.updateIssue(scope, issueId, { status });
  }

  revalidateIssue(projectId);
}

/**
 * Release an issue to the client, or withdraw it. Contractor only.
 *
 * The checkbox is read as a presence test: an unchecked box submits nothing at
 * all, so reading only the present keys would make withdrawing a no-op.
 */
export async function releaseIssue(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'publish', 'issue');

  const issueId = required(formData, 'issueId');
  const projectId = required(formData, 'projectId');

  await ops.updateIssue(scope, issueId, {
    clientVisible: formData.get('clientVisible') !== null,
    // Released together, because an issue with no client line is one nobody has
    // decided what to say about yet.
    clientUpdate: String(formData.get('clientUpdate') ?? ''),
  });

  revalidateIssue(projectId);
  revalidatePath('/portal/issues');
}

/** Archive an issue. Contractor only, and it archives rather than deletes. */
export async function archiveIssue(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'archive', 'issue');

  const issueId = required(formData, 'issueId');
  const projectId = required(formData, 'projectId');

  await ops.archiveIssue(scope, issueId, { name: access.session.name });
  revalidateIssue(projectId);
}

// ── Punch list ──────────────────────────────────────────────────────────────
//
// A punch item is an issue in the `Punch List` category. See `operational.ts`
// for why there is no second table.

/** Add a closeout item. Contractor or field. */
export async function addPunchItem(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'create', 'punchList');

  const projectId = required(formData, 'projectId');
  await assertOnProject(access, scope, projectId);

  await ops.createIssue(scope, {
    projectId,
    issueTitle: required(formData, 'title'),
    category: PUNCH_CATEGORY,
    description: String(formData.get('description') ?? ''),
    // The punch list calls this the location; it is the same column.
    projectArea: String(formData.get('location') ?? ''),
    priority: 'Normal',
    targetResolutionDate: optionalDate(formData, 'targetDate'),
    internalNotes: String(formData.get('internalNotes') ?? ''),
    raisedBy: access.session.name,
    raisedByRole: access.role,
  });

  revalidatePunch(projectId);
}

/**
 * Move a punch item along.
 *
 * A field user may take an item Open → Scheduled → Completed. **Verified is
 * the office's word, not theirs** — a role that can verify its own work is not
 * a check on it, and the whole reason the state exists is that somebody else
 * looked. Refused server-side rather than merely left off the field screen.
 */
export async function setPunchStatus(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'update', 'punchList');

  const issueId = required(formData, 'issueId');
  const projectId = required(formData, 'projectId');
  await assertOnProject(access, scope, projectId);

  const label = required(formData, 'status') as PunchListItem['status'];
  const status = ISSUE_STATUS_FOR_PUNCH[label];
  if (status === undefined) throw new Error(`unknown punch status: ${label}`);

  if (access.role !== 'contractor' && label === 'Verified') {
    throw new Error('only the office can verify a punch list item');
  }

  await ops.updateIssue(scope, issueId, { status });
  revalidatePunch(projectId);
}

/** Release a punch item to the client, or withdraw it. Contractor only. */
export async function releasePunchItem(formData: FormData): Promise<void> {
  const { access, scope, ops } = await issueContext();
  assertCan(access.role, 'publish', 'punchList');

  const issueId = required(formData, 'issueId');
  const projectId = required(formData, 'projectId');

  await ops.updateIssue(scope, issueId, {
    clientVisible: formData.get('clientVisible') !== null,
  });

  revalidatePunch(projectId);
}
