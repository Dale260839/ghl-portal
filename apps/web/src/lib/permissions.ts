import type { Role } from './demo-accounts.ts';

/**
 * Who may do what, to which record.
 *
 * ---------------------------------------------------------------------------
 * This replaces an earlier reading of D4 §5 that was too narrow. That section
 * says the PM decision buttons *"live in the Hub only — nothing in GHL … this is
 * the one place the Hub owns the action."* It means the publish decision is not
 * duplicated in GoHighLevel. It does **not** mean the Hub only ever writes one
 * thing — §12.1 is explicit that the contractor dashboard *"creates and controls
 * everything the other two experiences display"*, and D2 lists create-forms for
 * projects, milestones, tasks, selections, change orders, issues, messages,
 * punch list and warranty.
 *
 * So permission is a matrix, not a rule. What follows is that matrix, and the
 * four genuine exceptions to it.
 * ---------------------------------------------------------------------------
 *
 * **Exception 1 — stage completion belongs to GoHighLevel.** D4 §5: *"A
 * contractor does not flip 'in progress → complete' inside the Hub. The Hub
 * reflects completion once GHL marks it."* No role has `completeStage`. That is
 * not an oversight; it is the entry that makes the point.
 *
 * **Exception 2 — publishing is the contractor's alone.** The field crew
 * *proposes* wording and never decides. §12.2: "submits only — never publishes."
 *
 * **Exception 3 — nobody deletes anything but a contractor.** A crew member or
 * a homeowner removing a record destroys the audit trail the approval model
 * depends on. They correct by adding, not by erasing.
 *
 * **Exception 4 — the money resources admit no field or client write at all.**
 * §9.3 and §9.4.
 *
 * Ownership is a separate question and this module does not answer it: "may a
 * field user update a task" is here, "may they update *this* task" is
 * `ownsTask` below. Both have to pass.
 */

export type Resource =
  | 'project'
  | 'milestone'
  | 'task'
  | 'dailyUpdate'
  | 'selection'
  | 'changeOrder'
  | 'document'
  | 'photo'
  | 'message'
  | 'issue'
  | 'punchList'
  | 'warranty'
  | 'visibilitySettings'
  | 'invoice';

export type Action =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  /** Make a record visible to the homeowner. The §10 gate, contractor only. */
  | 'publish'
  /** A client accepting a selection or a change order. */
  | 'approve'
  /** Move a project to Completed. Nobody — GoHighLevel owns this. */
  | 'completeStage';

type Matrix = Record<Resource, Partial<Record<Action, readonly Role[]>>>;

const CONTRACTOR: readonly Role[] = ['contractor'];
const CONTRACTOR_AND_FIELD: readonly Role[] = ['contractor', 'field'];
const EVERYONE: readonly Role[] = ['contractor', 'field', 'client'];

/**
 * An absent action means nobody, which is why `completeStage` appears nowhere
 * and `delete` appears only against a contractor.
 */
const MATRIX: Matrix = {
  // §12.1 — the contractor creates and controls the project record. `update`
  // covers every field EXCEPT the stage, which has its own action below.
  project: {
    create: CONTRACTOR,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
    // completeStage: deliberately absent for every role. See exception 1.
  },

  milestone: {
    create: CONTRACTOR,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  // The crew starts and completes their own work; the office assigns it.
  task: {
    create: CONTRACTOR,
    read: CONTRACTOR_AND_FIELD,
    update: CONTRACTOR_AND_FIELD,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  // §12.2 — the crew submits, the PM publishes. Both write; only one decides.
  dailyUpdate: {
    create: CONTRACTOR_AND_FIELD,
    read: EVERYONE,
    update: CONTRACTOR_AND_FIELD,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  // A client approves a selection but never edits one — the terms are the
  // contractor's to set, and the answer is the client's to give.
  selection: {
    create: CONTRACTOR,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
    approve: ['contractor', 'client'],
  },

  changeOrder: {
    create: CONTRACTOR,
    read: ['contractor', 'client'],
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
    approve: ['contractor', 'client'],
  },

  // §6.1 `Allow File Uploads` decides whether a client may add one; that switch
  // is checked separately, on top of this.
  document: {
    create: EVERYONE,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  photo: {
    create: CONTRACTOR_AND_FIELD,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  // Everyone writes messages; the threads they can reach differ, which is
  // `fieldMessages` and the §9.1 gate rather than this matrix.
  message: {
    create: EVERYONE,
    read: EVERYONE,
    update: CONTRACTOR,
    delete: CONTRACTOR,
  },

  // §6.1 `Allow Issue Submission` gates the client half.
  issue: {
    create: EVERYONE,
    read: EVERYONE,
    update: CONTRACTOR_AND_FIELD,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  punchList: {
    create: CONTRACTOR_AND_FIELD,
    read: EVERYONE,
    update: CONTRACTOR_AND_FIELD,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  warranty: {
    create: ['contractor', 'client'],
    read: ['contractor', 'client'],
    update: CONTRACTOR,
    delete: CONTRACTOR,
    publish: CONTRACTOR,
  },

  // The gate's own switches. Only the person who owns the client relationship
  // decides what crosses, and they are not readable by anyone else — knowing
  // which switches are off tells you what exists behind them.
  visibilitySettings: {
    read: CONTRACTOR,
    update: CONTRACTOR,
  },

  // Money. §9.3 and §9.4: no field write, no client write, no client read of
  // the internals. A client reads their own invoice through the portal's gated
  // projection, not through this resource.
  invoice: {
    create: CONTRACTOR,
    read: CONTRACTOR,
    update: CONTRACTOR,
    delete: CONTRACTOR,
  },
};

export function can(role: Role, action: Action, resource: Resource): boolean {
  return MATRIX[resource][action]?.includes(role) ?? false;
}

export class PermissionError extends Error {
  constructor(role: Role, action: Action, resource: Resource) {
    super(`${role} may not ${action} a ${resource}`);
    this.name = 'PermissionError';
  }
}

/**
 * Throws unless the role may act. Server actions call this **before** touching
 * anything — the button being hidden is a UI fact, and a server action is
 * something anyone can post to.
 */
export function assertCan(role: Role, action: Action, resource: Resource): void {
  if (!can(role, action, resource)) throw new PermissionError(role, action, resource);
}

/** Every action a role may take on a resource. Drives which buttons render. */
export function allowedActions(role: Role, resource: Resource): Action[] {
  return (Object.keys(MATRIX[resource]) as Action[]).filter((a) => can(role, a, resource));
}

// ── Ownership ───────────────────────────────────────────────────────────────
// The matrix answers "may this ROLE do this at all". These answer "may they do
// it to THIS record". Both must pass, and they are separate because conflating
// them is how a field user ends up able to close somebody else's task.

/** §9.4 — a crew member acts only on work assigned to them. */
export function ownsTask(
  user: { role: Role; name: string },
  task: { assignedTo: string | null },
): boolean {
  if (user.role === 'contractor') return true;
  if (user.role !== 'field') return false;
  return task.assignedTo !== null && task.assignedTo === user.name;
}

/** §9.1 — a homeowner acts only on their own project's records. */
export function ownsAsClient(
  user: { role: Role; contactId?: string },
  record: { contactId: string },
): boolean {
  if (user.role === 'contractor') return true;
  if (user.role !== 'client') return false;
  return user.contactId !== undefined && user.contactId === record.contactId;
}
