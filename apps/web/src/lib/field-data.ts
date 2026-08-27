import type { Message, Project, Task } from './data/types.ts';

/**
 * What a field user may see, as pure functions.
 *
 * §9.4 is a short list and every item on it is a way to embarrass a contractor:
 * a superintendent must never see profit, markups, internal financial reports,
 * client payment details, **unassigned projects**, private client messages,
 * employee records, or company-wide administration.
 *
 * Two of those are filtering problems and the rest are projection problems, so
 * both live here rather than in a screen. Pure so `node --test` can assert them
 * without a session.
 *
 * D4 §5 adds the assignment loop: *"contractor can assign tasks in the notes;
 * the field person gets a notification/ding."* `unseenCount` is the ding.
 */

/**
 * A project as a field user may see it.
 *
 * Every money field is dropped by construction — not zeroed, not hidden. A
 * property that does not exist cannot be rendered by a screen that forgets, and
 * cannot be serialised by anything that iterates keys.
 */
export type FieldProject = Omit<
  Project,
  | 'contractAmount'
  | 'approvedChangeOrders'
  | 'pendingChangeOrders'
  | 'currentProjectTotal'
  | 'amountInvoiced'
  | 'amountPaid'
  | 'remainingBalance'
  | 'nextPaymentAmount'
  | 'nextPaymentDueDate'
  | 'originalEstimate'
  | 'internalMarkup'
  | 'margin'
  | 'budgetBand'
  // The client-visibility switches go too. They are not on §9.4's list because
  // they carry no money — but they are contractor-side configuration about the
  // homeowner relationship, and a crew member has no use for "does the client
  // see the budget". Dropping them also keeps the money heuristic in the tests
  // strict rather than carving out an exception for `showBudgetToClient`.
  | 'clientPortalEnabled'
  | 'showBudgetToClient'
  | 'showDetailedPricing'
  | 'showScheduleToClient'
  | 'showAssignedTeam'
  | 'allowClientMessaging'
  | 'allowIssueSubmission'
  | 'allowFileUploads'
>;

export function toFieldProject(project: Project): FieldProject {
  const {
    contractAmount: _contract,
    approvedChangeOrders: _approved,
    pendingChangeOrders: _pending,
    currentProjectTotal: _total,
    amountInvoiced: _invoiced,
    amountPaid: _paid,
    remainingBalance: _balance,
    nextPaymentAmount: _next,
    nextPaymentDueDate: _due,
    originalEstimate: _estimate,
    internalMarkup: _markup,
    margin: _margin,
    budgetBand: _band,
    clientPortalEnabled: _portal,
    showBudgetToClient: _showBudget,
    showDetailedPricing: _showPricing,
    showScheduleToClient: _showSchedule,
    showAssignedTeam: _showTeam,
    allowClientMessaging: _messaging,
    allowIssueSubmission: _issues,
    allowFileUploads: _uploads,
    ...safe
  } = project;
  return safe;
}

/**
 * The projects this crew member is on.
 *
 * §9.4's "unassigned projects" clause. Fixtures assign by superintendent; with
 * live data this filters on the project's Field Team association.
 */
export function projectsForField(projects: Project[], fieldUser: string): FieldProject[] {
  return projects
    .filter((p) => p.superintendent === fieldUser)
    .map(toFieldProject);
}

/**
 * The tasks assigned to this person, on projects they are on.
 *
 * Both conditions, deliberately. A task assigned to someone else on a project
 * they share is still not theirs, and a task assigned to them on a project they
 * are not on should not appear either — that combination means something is
 * wrong upstream and showing it would hide the problem.
 */
export function tasksForField(
  tasks: Task[],
  projects: FieldProject[],
  fieldUser: string,
): Task[] {
  const mine = new Set(projects.map((p) => p.buildsuiteProjectId));
  return tasks
    .filter((t) => t.assignedTo === fieldUser && mine.has(t.projectId))
    // Newest assignment first, so a fresh ding is at the top of the screen.
    .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
}

/** The ding. Assignments the crew member has not opened yet. */
export function unseenCount(tasks: Task[]): number {
  return tasks.filter((t) => t.seenAt === null).length;
}

export function isUnseen(task: Task): boolean {
  return task.seenAt === null;
}

/**
 * The field ↔ PM thread for a project.
 *
 * D2 Step 3: *"Do not expose unrelated client or financial communication."* So
 * this returns internal messages only — anything marked client-visible is part
 * of the homeowner's conversation and is not the crew's business, in either
 * direction.
 */
export function fieldMessages(messages: Message[], projectIds: Set<string>): Message[] {
  return messages
    .filter((m) => projectIds.has(m.projectId))
    .filter((m) => !m.clientVisible)
    .filter((m) => !m.fromClient)
    .sort((a, b) => a.sentDate.localeCompare(b.sentDate));
}
