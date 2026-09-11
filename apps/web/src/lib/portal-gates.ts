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
  PAYMENT_SCHEDULE,
  PHOTOS,
  PUNCH_LIST,
  SCHEDULE_ITEMS,
  SELECTIONS,
} from './data/portal-fixtures.ts';
import { ISSUES, PROJECTS } from './data/fixtures.ts';
import { getHubSchedule } from './hub-db/schedule.ts';
import { getHubMedia } from './hub-db/media.ts';
import { getHubMessages } from './hub-db/messages.ts';
import { isUuid } from './data/visibility-overlay.ts';
import {
  getHubOperational,
  isPunchItem,
  punchItemFromIssue,
  type HubIssue,
} from './hub-db/operational.ts';
import { clientSelection, getHubSelections } from './hub-db/selections.ts';
import { hubScopeOfProject, scopeOfProject } from './tenant-scope.ts';
import { getProposalsReader, pickCurrentProposal } from './buildsuite/proposals.ts';
// Aliased: this module already has a `scheduleFor` — the WORK schedule.
import { scheduleFor as paymentLinesFor } from './payment-schedule.ts';
import { getHubInvoiceDrafts } from './hub-db/invoice-drafts.ts';
import {
  clientPaymentSchedule,
  type ClientScheduleLine,
  type DraftLink,
  type IssuedInvoiceRef,
} from './client-payment-schedule.ts';
import { clientCanSeeDocument } from './document-folders.ts';
import type {
  BudgetLine,
  ClientPaymentLine,
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

/** What a homeowner sees of a file. No uploader name — §9.4 employee records. */
export interface ClientFile {
  id: string;
  label: string;
  category: string;
  storagePath: string | null;
  externalUrl: string | null;
  createdAt: string;
}

/** What a homeowner sees of an appointment. The crew notes are not on it. */
export interface ClientScheduleItem {
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  trade: string;
  status: string;
  notes: string;
}

function portalOpen(project: Project): boolean {
  return project.clientPortalEnabled;
}

export function projectFor(buildsuiteProjectId: string): Project | null {
  return PROJECTS.find((p) => p.buildsuiteProjectId === buildsuiteProjectId) ?? null;
}

/**
 * The schedule a homeowner sees.
 *
 * ---------------------------------------------------------------------------
 * READS THE HUB, NOT FIXTURES (2026-09-10)
 *
 * The contractor's Schedule screen writes `hub_schedule_items`. This read stayed
 * on `SCHEDULE_ITEMS` from a fixture file, so releasing an appointment did
 * nothing a homeowner could see — the switch was decorative on this side.
 *
 * Both halves of §9.1 still apply, in the same order:
 *
 *   1. `portalOpen(project)` — the per-project master switch
 *   2. `client_visible` on the row — filtered in the query, not after it
 *
 * The tenant filter comes from the PROJECT, not from a session: a homeowner
 * holds no tenant scope, and `scopeOfProject` is the only legitimate way to get
 * one for a project they were already authorized to read.
 * ---------------------------------------------------------------------------
 */
export async function scheduleFor(project: Project): Promise<ClientScheduleItem[]> {
  if (!portalOpen(project)) return [];

  const hub = getHubSchedule();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const items = await hub.schedule.listForProject(
    scope,
    project.buildsuiteProjectId,
  );

  return items
    .filter((item) => item.clientVisible)
    .map((item) => ({
      id: item.id,
      title: item.title,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      trade: item.trade,
      status: item.status,
      // The contractor's own notes are NOT published. A homeowner sees when
      // work is happening and what it is, not the crew instructions.
      notes: '',
    }));
}

/**
 * The documents a homeowner sees. Reads `hub_documents`, not fixtures.
 *
 * A file is shown only when the portal is open AND the row is released. The
 * `storagePath` is passed through so the screen can link to the download route,
 * which mints a short-lived signed URL — the bucket is private, so nothing here
 * is reachable by URL alone.
 */
export async function documentsFor(project: Project): Promise<ClientFile[]> {
  return filesFor(project, 'document');
}

/** The photos a homeowner sees. Same rules as documents. */
export async function photosFor(project: Project): Promise<ClientFile[]> {
  return filesFor(project, 'photo');
}

async function filesFor(project: Project, kind: 'document' | 'photo'): Promise<ClientFile[]> {
  if (!portalOpen(project)) return [];
  // The per-section switch, set on the Visibility screen. Off means the whole
  // section is withheld, whatever the individual rows say.
  if (kind === 'document' && !project.showDocuments) return [];
  if (kind === 'photo' && !project.showPhotos) return [];

  const hub = getHubMedia();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const items = await hub.media.listForProject(
    scope,
    kind,
    project.buildsuiteProjectId,
  );

  // Documents carry a second gate: the folder. The release switch alone is not
  // enough, because a row released before folders existed still sits in a
  // legacy category, and one released and later moved into a trade folder
  // would otherwise keep showing. Photos have no folders, so the switch is all
  // there is on that side.
  return items
    .filter((item) =>
      kind === 'document'
        ? clientCanSeeDocument({ category: item.category, clientVisible: item.clientVisible })
        : item.clientVisible,
    )
    .map((item) => ({
      id: item.id,
      label: item.label,
      category: item.category,
      storagePath: item.storagePath,
      externalUrl: item.externalUrl,
      createdAt: item.createdAt,
      // `uploadedBy` is a member of the contractor's team. §9.4 keeps employee
      // records off a client screen, so the name does not travel.
    }));
}



/**
 * The messages a homeowner sees.
 *
 * ---------------------------------------------------------------------------
 * READS THE HUB, NOT FIXTURES (2026-09-10)
 *
 * Same story as the schedule. Every message screen rendered the same in-memory
 * array, so nothing anyone typed survived the request and the three sides of
 * the conversation never met. This reads `hub_messages`.
 *
 * The gate is the master switch, `clientPortalEnabled`. It used to be
 * `allowClientMessaging`, which BuildSuite never sets and the Hub has no column
 * for, so on every live project it was false and the homeowner's thread was
 * permanently shut. Portal on means they have a thread; the fixture projects
 * keep their own flag so the demo data reads the way it always has.
 *
 * `clientVisibleOnly` is passed down to the QUERY. An internal note is never
 * fetched here, so no screen can leak one by forgetting to filter.
 * ---------------------------------------------------------------------------
 */
export async function messagesFor(project: Project): Promise<Message[]> {
  if (!portalOpen(project)) return [];

  const projectId = project.buildsuiteProjectId;
  const hub = getHubMessages();
  if (hub.available && isUuid(projectId)) {
    const scope = await hubScopeOfProject(project);
    if (scope === null) return [];
    const rows = await hub.messages.listForProject(scope, projectId, {
      clientVisibleOnly: true,
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      threadId: `project-${row.projectId}`,
      threadCategory: 'Project',
      sender: row.author,
      senderRole: row.authorRole,
      fromClient: row.authorRole === 'client',
      message: row.body,
      sentDate: row.createdAt,
      clientVisible: true,
    }));
  }

  // Fixture projects: the id is not a uuid, so the uuid-keyed table cannot be
  // asked about them. §6.1's per-project messaging flag still applies here.
  if (!project.allowClientMessaging) return [];
  return MESSAGES.filter((m) => m.projectId === projectId && m.clientVisible).sort((a, b) =>
    a.sentDate.localeCompare(b.sentDate),
  );
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

/**
 * Takes the Hub shape as well as the fixture one, so the extra columns a stored
 * row carries are destructured away here rather than riding along on an object
 * spread. `clientVisible` and `raisedByRole` are not secrets, but a client
 * response should carry what the client needs and nothing else.
 */
function toClientIssue(i: Issue | HubIssue): ClientIssue {
  const {
    internalNotes: _notes,
    assignedTo: _assignee,
    ...rest
  } = i as HubIssue;
  const {
    clientVisible: _visible,
    raisedByRole: _role,
    resolvedAt: _resolved,
    ...safe
  } = rest;
  return safe;
}

/**
 * Issues the client may see.
 *
 * ---------------------------------------------------------------------------
 * READS THE HUB, NOT FIXTURES (2026-09-10)
 *
 * The contractor's Issues screen and the crew's phones both write `hub_issues`.
 * This read stayed on the `ISSUES` fixture, so releasing an issue did nothing a
 * homeowner could see — the switch was decorative on this side, exactly as the
 * schedule's was before it.
 *
 * Converted the way `changeOrdersFor` was: fixture projects keep their fixture
 * data so the demo and the gate tests still have something to prove a rule
 * against, and a real project reads the database.
 *
 * The gate is now BOTH halves rather than a proxy for one of them. It used to
 * be "has a client update", because `Issue` had no per-row switch to read; the
 * stored row has `client_visible`, so the rule is the portal master switch plus
 * that flag plus a client line actually written. An issue released with nothing
 * written for the homeowner would show them a bare title and no answer.
 *
 * Punch list items live in the same table under their own category. They belong
 * to `punchListFor` and are excluded here, or a snag would appear twice.
 * ---------------------------------------------------------------------------
 */
export async function issuesFor(project: Project): Promise<ClientIssue[]> {
  if (!portalOpen(project)) return [];

  if (projectFor(project.buildsuiteProjectId) !== null) {
    return ISSUES.filter(
      (i) => i.projectId === project.buildsuiteProjectId && i.clientUpdate.trim() !== '',
    )
      .map(toClientIssue)
      .sort((a, b) => b.submittedDate.localeCompare(a.submittedDate));
  }

  const hub = getHubOperational();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const rows = await hub.ops.listIssues(
    scope,
    project.buildsuiteProjectId,
  );

  return rows
    .filter((i) => !isPunchItem(i) && i.clientVisible && i.clientUpdate.trim() !== '')
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

/**
 * The selections a homeowner sees.
 *
 * Projected through `clientSelection`, which builds the client shape BY
 * LITERAL — so `actualCost`, what the contractor actually pays, is not dropped
 * here, it is never present. See §9.3 and `hub-db/selections.ts`.
 */
export async function selectionsFor(project: Project) {
  if (!portalOpen(project)) return [];

  const hub = getHubSelections();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const rows = await hub.selections.listSelections(
    scope,
    project.buildsuiteProjectId,
  );
  return rows.filter((r) => r.clientVisible).map(clientSelection);
}


/**
 * The change orders a homeowner sees — the ones sent to them for a decision.
 *
 * Every figure here is §9.3 allow-list: a client being asked to approve a
 * change has to see what it costs. There is no internal number on a change
 * order at all, which is why this needs no projection.
 */
export async function changeOrdersFor(project: Project) {
  if (!portalOpen(project)) return [];
  if (!project.showChangeOrders) return [];

  const hub = getHubSelections();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const rows = await hub.selections.listChangeOrders(
    scope,
    project.buildsuiteProjectId,
  );
  return rows.filter((r) => r.clientVisible);
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
 *
 * Hub-backed since 2026-09-10, the same way `issuesFor` is, and for the same
 * reason: the contractor's Completion screen and the crew's phones write these
 * rows, and a release that nothing read was a switch connected to nothing. A
 * stored punch item is a `hub_issues` row in the `Punch List` category —
 * `punchItemFromIssue` is the one place that translation lives.
 */
export async function punchListFor(project: Project): Promise<ClientPunchItem[]> {
  if (!portalOpen(project)) return [];

  if (projectFor(project.buildsuiteProjectId) !== null) {
    return PUNCH_LIST.filter((p) => p.projectId === project.buildsuiteProjectId && p.clientVisible)
      .map(toClientPunchItem)
      .sort((a, b) => a.itemNumber.localeCompare(b.itemNumber));
  }

  const hub = getHubOperational();
  if (!hub.available) return [];

  const scope = await hubScopeOfProject(project);
  if (scope === null) return [];

  const rows = await hub.ops.listIssues(
    scope,
    project.buildsuiteProjectId,
  );

  return rows
    .filter((i) => isPunchItem(i) && i.clientVisible)
    .map(punchItemFromIssue)
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

/**
 * The client-facing payment schedule.
 *
 * Gated the same way documents and photos are: the portal master switch, then
 * each line's own `clientVisible`. Payments are inherently the client's to see —
 * they have to know what they owe — so there is no separate money switch here,
 * unlike the budget; the per-line flag is what withholds a line that a
 * contractor has not yet chosen to surface.
 *
 * The type carries no cost or margin field, so this cannot leak an internal
 * figure even if a fixture tried to.
 */
/**
 * The homeowner's live payment schedule — from the contract they signed.
 *
 * `paymentsFor` below reads the `PAYMENT_SCHEDULE` fixture and nothing calls
 * it; this is the live version of the same design, and follows its recorded
 * decision exactly: gated by the portal master switch, and NO separate money
 * switch, because "payments are inherently the client's to see — they have to
 * know what they owe".
 *
 * ---------------------------------------------------------------------------
 * ONLY A CONTRACT SOMEBODY AGREED TO
 *
 * The schedule comes from the project's current proposal, and only when it is
 * signed or won (`accepted`) — the same bar the Projects list uses. A quoted
 * proposal's schedule is a number nobody agreed to, and showing it to a
 * homeowner as "what you will pay" is the argument the invoice rule exists to
 * prevent.
 *
 * ---------------------------------------------------------------------------
 * EVERY FAILURE DEGRADES TO "NO SCHEDULE", NEVER TO AN ERROR PAGE
 *
 * BuildSuite unreachable, the Hub offline (as it is until the Hub key is swapped
 * for the secret one), a contractor that cannot be resolved — each returns fewer
 * facts, not a crash. Without the Hub the schedule still shows, it just cannot
 * mark which lines have been billed, so every line reads as upcoming. That is
 * honest: nothing has been proven billed.
 * ---------------------------------------------------------------------------
 */
export async function paymentScheduleForClient(
  project: Project,
  /** This homeowner's ISSUED invoices only — drafts and voids already removed. */
  issuedInvoices: readonly IssuedInvoiceRef[],
): Promise<{ lines: ClientScheduleLine[]; contractTotal: number | null }> {
  const none = { lines: [], contractTotal: null };
  if (!portalOpen(project)) return none;

  const reader = getProposalsReader();
  if (!reader.available) return none;

  let scope;
  try {
    scope = scopeOfProject(project);
    const proposals = await reader.listForProjects(scope, [project.buildsuiteProjectId]);
    const current = pickCurrentProposal(proposals);
    // Signed, or won. Anything short of that is a quote.
    if (current === null || !(current.signed || current.status === 'accepted')) return none;

    const source = await reader.readSchedule(scope, project.buildsuiteProjectId, current.id);
    const lines = paymentLinesFor(source);
    if (lines.length === 0) return none;

    // Which lines became invoices. Optional: without it every line is upcoming.
    let links: DraftLink[] = [];
    const drafts = getHubInvoiceDrafts();
    if (drafts.available) {
      try {
        const hubScope = await hubScopeOfProject(project);
        if (hubScope !== null) {
          links = (await drafts.drafts.listForProposal(hubScope, current.id)).map((d) => ({
            lineOrder: d.lineOrder,
            externalId: d.externalId,
          }));
        }
      } catch (err) {
        console.warn(`[portal] invoice links unavailable for ${project.buildsuiteProjectId}:`, (err as Error).message);
        links = [];
      }
    }

    return {
      lines: clientPaymentSchedule({
        lines,
        contractTotal: current.amount,
        links,
        invoices: issuedInvoices,
      }),
      contractTotal: current.amount,
    };
  } catch (err) {
    // Degrade, but never silently. A homeowner sees no schedule rather than an
    // error page; the operator sees why. Swallowing this without a word is how a
    // real bug — found while testing this, a TypeError — would pass for "this
    // project has no schedule".
    console.warn(`[portal] payment schedule unavailable for ${project.buildsuiteProjectId}:`, (err as Error).message);
    return none;
  }
}

export function paymentsFor(project: Project): ClientPaymentLine[] {
  if (!portalOpen(project)) return [];
  return PAYMENT_SCHEDULE.filter(
    (p) => p.projectId === project.buildsuiteProjectId && p.clientVisible,
  ).sort((a, b) => a.position - b.position);
}

/**
 * Payment totals, derived one place so no screen re-computes them differently.
 *
 * `paid` and `outstanding` follow the line status, not a guess: a line counts as
 * outstanding once it is invoiced and not yet paid, which is exactly what a
 * homeowner reads as "what I owe right now".
 */
export function paymentSummary(lines: ClientPaymentLine[]): {
  contractValue: number;
  paid: number;
  outstanding: number;
  upcoming: number;
} {
  let contractValue = 0;
  let paid = 0;
  let outstanding = 0;
  let upcoming = 0;
  for (const line of lines) {
    contractValue += line.amount;
    if (line.status === 'Paid') paid += line.amount;
    else if (line.status === 'Invoiced' || line.status === 'Due') outstanding += line.amount;
    else upcoming += line.amount;
  }
  return { contractValue, paid, outstanding, upcoming };
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

