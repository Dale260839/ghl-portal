/**
 * Every client-facing read, and the gates on it.
 *
 * Split out of `portal-data.ts` for one reason: these are pure functions of a
 * `Project`, and that file also resolves the *current* project, which needs a
 * session and therefore `next/headers`. Importing it into a test pulls in the
 * whole Next request context.
 *
 * The gate rules are the ones most worth testing in isolation — §9.1's switches
 * and §9.3's deny-list — so they live where `node --test` can reach them
 * without a running server. `portal-data.ts` re-exports all of it, so no screen
 * had to change.
 */

import {
  BUDGET_LINES,
  CHANGE_ORDERS,
  DOCUMENTS,
  MESSAGES,
  PHOTOS,
  PUNCH_LIST,
  SCHEDULE_ITEMS,
  SELECTIONS,
} from './data/portal-fixtures.ts';
import { ISSUES, PROJECTS } from './data/fixtures.ts';
import type {
  BudgetLine,
  Issue,
  ChangeOrder,
  MaterialSelection,
  Message,
  Project,
  ProjectDocument,
  ProjectPhoto,
  PunchListItem,
  ScheduleItem,
} from './data/types.ts';

/**
 * The client-visibility gates, as pure functions of a project.
 *
 * Every one applies the same two rules the rest of the portal does:
 *
 *   1. **The project's portal must be enabled** (§9.1). If a contractor turns
 *      the portal off, no screen returns anything, regardless of per-item flags.
 *   2. **Each item must be client-visible.** Default-deny — the fixtures include
 *      a withheld document and a withheld photo precisely so that a list showing
 *      everything would fail to prove anything.
 *
 * Kept separate from `ProjectDataSource` on purpose: these are portal reads with
 * a fixed shape, not the tenant-scoped staff reads. When the `hub_*` tables are
 * live this file changes and no screen does.
 */

function portalOpen(project: Project): boolean {
  return project.clientPortalEnabled;
}

export function projectFor(buildsuiteProjectId: string): Project | null {
  return PROJECTS.find((p) => p.buildsuiteProjectId === buildsuiteProjectId) ?? null;
}

export function scheduleFor(project: Project): ScheduleItem[] {
  if (!portalOpen(project)) return [];
  // §6.1 — the schedule switch gates this whole screen, not just the dates on it.
  if (!project.showScheduleToClient) return [];
  return SCHEDULE_ITEMS.filter(
    (s) => s.projectId === project.buildsuiteProjectId && s.clientVisible,
  ).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
}

export function documentsFor(project: Project): ProjectDocument[] {
  if (!portalOpen(project)) return [];
  return DOCUMENTS.filter(
    (d) => d.projectId === project.buildsuiteProjectId && d.clientVisible,
  ).sort((a, b) => b.uploadedDate.localeCompare(a.uploadedDate));
}

export function photosFor(project: Project): ProjectPhoto[] {
  if (!portalOpen(project)) return [];
  return PHOTOS.filter((p) => p.projectId === project.buildsuiteProjectId && p.clientVisible).sort(
    (a, b) => b.takenDate.localeCompare(a.takenDate),
  );
}

export function messagesFor(project: Project): Message[] {
  if (!portalOpen(project)) return [];
  // §6.1 — a contractor can switch client messaging off entirely.
  if (!project.allowClientMessaging) return [];
  return MESSAGES.filter(
    (m) => m.projectId === project.buildsuiteProjectId && m.clientVisible,
  ).sort((a, b) => a.sentDate.localeCompare(b.sentDate));
}

/**
 * An issue as the client may see it (§9.3).
 *
 * `internalNotes` is dropped by construction, the same way `actualCost` is on a
 * selection: the returned object has no such property. `clientUpdate` is its
 * deliberate counterpart — what the PM chose to tell them.
 *
 * `assignedTo` also goes. Who inside the company picked it up is not the
 * client's business, and naming a person invites them to chase that person
 * directly rather than the PM.
 */
export type ClientIssue = Omit<Issue, 'internalNotes' | 'assignedTo'>;

function toClientIssue(i: Issue): ClientIssue {
  const { internalNotes: _notes, assignedTo: _assignee, ...safe } = i;
  return safe;
}

/**
 * Issues the client may see.
 *
 * §6.1 has no per-issue client-visible switch, so the rule is the portal master
 * switch plus a published `clientUpdate`: an issue nobody has written a client
 * line for is one nobody has decided to tell them about.
 */
export function issuesFor(project: Project): ClientIssue[] {
  if (!portalOpen(project)) return [];
  return ISSUES.filter(
    (i) => i.projectId === project.buildsuiteProjectId && i.clientUpdate.trim() !== '',
  )
    .map(toClientIssue)
    .sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));
}

/**
 * A selection as the client may see it (§9.3).
 *
 * `actualCost` is dropped by construction — the returned object has no such
 * property, rather than one set to zero or filtered later. A field that is never
 * copied cannot be leaked by a screen that forgets to omit it.
 */
export type ClientSelection = Omit<MaterialSelection, 'actualCost'>;

function toClientSelection(s: MaterialSelection): ClientSelection {
  const { actualCost: _internal, ...safe } = s;
  return safe;
}

export function selectionsFor(project: Project): ClientSelection[] {
  if (!portalOpen(project)) return [];
  return SELECTIONS.filter(
    (s) => s.projectId === project.buildsuiteProjectId && s.clientVisible,
  ).map(toClientSelection);
}

export function changeOrdersFor(project: Project): ChangeOrder[] {
  if (!portalOpen(project)) return [];
  return CHANGE_ORDERS.filter(
    (c) => c.projectId === project.buildsuiteProjectId && c.clientVisible,
  ).sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

/**
 * A punch item as the client may see it (§9.3).
 *
 * `internalNotes` is dropped by construction — the returned object has no such
 * property, the same way `actualCost` is on a selection. A field that is never
 * copied cannot be leaked by a screen that forgets to omit it.
 */
export type ClientPunchItem = Omit<PunchListItem, 'internalNotes'>;

function toClientPunchItem(p: PunchListItem): ClientPunchItem {
  const { internalNotes: _notes, ...safe } = p;
  return safe;
}

/**
 * The punch list the client may see.
 *
 * A closeout item is a task inside the contract, not a priced change, so the
 * gate is the portal master switch plus the per-item publish flag — no budget
 * switch. Oldest number first, so the list reads as a sequence.
 */
export function punchListFor(project: Project): ClientPunchItem[] {
  if (!portalOpen(project)) return [];
  return PUNCH_LIST.filter((p) => p.projectId === project.buildsuiteProjectId && p.clientVisible)
    .map(toClientPunchItem)
    .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
}

/**
 * The per-category budget.
 *
 * Gated twice: the portal master switch, then §6.1 `Show Budget to Client`.
 * A contractor who turns the budget off gets an empty list, not a hidden table.
 */
export function budgetFor(project: Project): BudgetLine[] {
  if (!portalOpen(project)) return [];
  if (!project.showBudgetToClient) return [];
  return BUDGET_LINES.filter((b) => b.projectId === project.buildsuiteProjectId);
}

/** Column totals, so the screen never re-derives them differently. */
export function budgetTotals(lines: BudgetLine[]): {
  contracted: number;
  changeOrders: number;
  invoiced: number;
  paid: number;
  total: number;
  outstanding: number;
} {
  const sum = (pick: (l: BudgetLine) => number) => lines.reduce((t, l) => t + pick(l), 0);
  const contracted = sum((l) => l.contracted);
  const changeOrders = sum((l) => l.changeOrders);
  const invoiced = sum((l) => l.invoiced);
  const paid = sum((l) => l.paid);
  return {
    contracted,
    changeOrders,
    invoiced,
    paid,
    total: contracted + changeOrders,
    outstanding: invoiced - paid,
  };
}

/**
 * The 19 → 6 stage mapping for the client-facing tracker.
 *
 * PROVISIONAL. The client demo shows six steps; our pipeline (§7) has nineteen,
 * because contractors need that granularity and homeowners do not. Nothing in
 * the architecture says how they collapse, so this is a reading, not a spec —
 * flagged alongside W1–W3 for someone who runs projects to confirm.
 */
export const CLIENT_STAGES = [
  'Planning',
  'Design',
  'Materials',
  'In Progress',
  'Inspection',
  'Completed',
] as const;

export type ClientStage = (typeof CLIENT_STAGES)[number];

const STAGE_MAP: Record<string, ClientStage> = {
  'New Project': 'Planning',
  'Estimate in Development': 'Planning',
  'Estimate Sent': 'Planning',
  'Estimate Approved': 'Planning',
  'Contract Sent': 'Planning',
  'Contract Signed': 'Planning',
  'Deposit Due': 'Planning',
  'Deposit Paid': 'Planning',
  Planning: 'Planning',
  'Design and Selections': 'Design',
  Permitting: 'Design',
  'Materials Ordered': 'Materials',
  Scheduled: 'Materials',
  'In Progress': 'In Progress',
  Inspection: 'Inspection',
  'Punch List': 'Inspection',
  'Final Payment Due': 'Inspection',
  Completed: 'Completed',
  Warranty: 'Completed',
};

export function clientStageFor(projectStage: string): ClientStage {
  // An unmapped stage lands on Planning rather than throwing. A client seeing
  // an early stage is confusing; a client seeing a crashed page is worse.
  return STAGE_MAP[projectStage] ?? 'Planning';
}

export function clientStageIndex(projectStage: string): number {
  return CLIENT_STAGES.indexOf(clientStageFor(projectStage));
}

