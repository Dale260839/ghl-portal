import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';
import type { InvoiceDraft } from '../payment-schedule.ts';

/**
 * Invoice drafts — the contractor's work on an invoice nobody has sent.
 *
 * Reads and writes the HUB database. BuildSuite is never written to.
 *
 * The shape of this repository follows from what the live data cannot supply.
 * A schedule line gives a percent and usually nothing else: for all four signed
 * proposals there is no amount and no title, because `proposals.total` is null
 * and `proposals.price` is a band string. So a draft is not a rendering of the
 * proposal — it is the proposal's line PLUS what the contractor added, and both
 * halves are stored so the screen can show what changed.
 *
 * Nothing here sends anything. `status` reaches 'sent' only through whichever
 * rail is eventually chosen.
 */

export type DraftStatus = 'draft' | 'ready' | 'sent' | 'void';

export interface StoredInvoiceDraft {
  id: string;
  projectId: string;
  proposalId: string;
  lineOrder: number;
  /** What the proposal said, kept so the screen can show what was parsed. */
  sourcePercent: number | null;
  sourceAmount: number | null;
  sourceRaw: string;
  /** What the contractor decided. Null means not yet supplied — never zero. */
  title: string | null;
  amount: number | null;
  description: string | null;
  notes: string | null;
  status: DraftStatus;
  sentAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

interface DraftRow {
  id: string;
  project_id: string;
  proposal_id: string;
  line_order: number;
  source_percent: string | number | null;
  source_amount: string | number | null;
  source_raw: string | null;
  title: string | null;
  amount: string | number | null;
  description: string | null;
  notes: string | null;
  status: string | null;
  sent_at: string | null;
  updated_at: string;
  updated_by: string | null;
}

/** Postgres returns `numeric` as a string. Null stays null; it never becomes 0. */
function num(value: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDraft(row: DraftRow): StoredInvoiceDraft {
  const status = row.status ?? 'draft';
  return {
    id: row.id,
    projectId: row.project_id,
    proposalId: row.proposal_id,
    lineOrder: row.line_order,
    sourcePercent: num(row.source_percent),
    sourceAmount: num(row.source_amount),
    sourceRaw: row.source_raw ?? '',
    title: row.title,
    amount: num(row.amount),
    description: row.description,
    notes: row.notes,
    status: (['draft', 'ready', 'sent', 'void'] as const).includes(status as DraftStatus)
      ? (status as DraftStatus)
      : 'draft',
    sentAt: row.sent_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export class HubInvoiceDrafts {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  /** Every stored draft for one proposal, in schedule order. */
  async listForProposal(scope: TenantScope, proposalId: string): Promise<StoredInvoiceDraft[]> {
    const contractorId = assertContractor(scope, 'invoice drafts');
    if (proposalId.trim() === '') return [];

    const rows = await this.client.select<DraftRow>({
      from: 'hub_invoice_drafts',
      filters: { contractor_id: `eq.${contractorId}`, proposal_id: `eq.${proposalId}` },
      order: 'line_order.asc',
      limit: 100,
    });
    return rows.map(toDraft);
  }

  /**
   * Create the drafts for a proposal's schedule, once.
   *
   * Upserts on `(proposal_id, line_order)` so re-opening the review screen does
   * not create a second draft for the same instalment — two drafts for one line
   * is two invoices a contractor could both send.
   *
   * **Only the source columns are written here.** A contractor's title, amount
   * and notes are deliberately not touched, so seeding never overwrites work
   * somebody has already done on a line.
   */
  async seedFromSchedule(
    scope: TenantScope,
    input: { projectId: string; proposalId: string; drafts: InvoiceDraft[] },
    actor: { name: string },
  ): Promise<void> {
    const contractorId = assertContractor(scope, 'seed invoice drafts');
    if (input.drafts.length === 0) return;

    const now = new Date().toISOString();
    const rows = input.drafts.map((d) => ({
      contractor_id: contractorId,
      project_id: input.projectId,
      proposal_id: input.proposalId,
      line_order: d.line.order,
      source_percent: d.line.percent,
      // What the PROPOSAL stated, not what was computed from a total. A
      // computed figure is a derivation, and storing it here would later be
      // indistinguishable from something the document actually said.
      source_amount: d.line.amount,
      source_raw: d.line.raw,
      updated_at: now,
      updated_by: actor.name,
    }));

    await this.client.upsert({ from: 'hub_invoice_drafts', rows }, 'proposal_id,line_order');
  }

  /**
   * Save what the contractor supplied for one line.
   *
   * Filtered on the asserted contractor as well as the draft id, so knowing an
   * id is not enough to edit another contractor's invoice.
   */
  async save(
    scope: TenantScope,
    draftId: string,
    patch: {
      title?: string | null;
      amount?: number | null;
      description?: string | null;
      notes?: string | null;
      status?: DraftStatus;
    },
    actor: { name: string },
  ): Promise<void> {
    const contractorId = assertContractor(scope, 'save invoice draft');
    if (draftId.trim() === '') throw new TypeError('draftId is required');

    if (patch.amount !== undefined && patch.amount !== null && patch.amount < 0) {
      throw new RangeError('an invoice amount cannot be negative');
    }

    await this.client.update({
      from: 'hub_invoice_drafts',
      filters: {
        id: `eq.${draftId}`,
        contractor_id: `eq.${contractorId}`,
        // A sent invoice is no longer a draft. Editing one would change a
        // document a homeowner already has.
        status: 'in.(draft,ready)',
      },
      patch: { ...patch, updated_at: new Date().toISOString(), updated_by: actor.name },
    });
  }
}

export type HubInvoiceDraftsResult =
  | { available: true; drafts: HubInvoiceDrafts }
  | { available: false; missing: string[] };

export function getHubInvoiceDrafts(): HubInvoiceDraftsResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, drafts: new HubInvoiceDrafts(hub.client) };
}
