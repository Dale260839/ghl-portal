import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';

/**
 * Material selections (§6.5) and change orders (§6.6).
 *
 * ---------------------------------------------------------------------------
 * THE ONE THING TO GET RIGHT HERE IS MONEY
 *
 * A selection carries `actualCost` — what the contractor actually pays — and it
 * is on the §9.3 deny-list. It lives on the type because the contractor's own
 * screen needs it, and it must never reach a client.
 *
 * Three things stop it, and none relies on a screen remembering:
 *
 *   · `clientSelection()` builds the client shape by construction, so the field
 *     is not dropped, it is never present
 *   · `stripInternalFields` removes it by name from any payload
 *   · a guardrail test fails if a client-facing projection carries it
 *
 * Change orders have no internal figure. `addedCost` and `creditAmount` are
 * both §9.3 allow-list — a homeowner is being asked to approve them.
 * ---------------------------------------------------------------------------
 */

export const SELECTION_STATUSES = [
  'Pending',
  'Awaiting Client',
  'Approved',
  'Rejected',
  'Ordered',
  'Installed',
] as const;

export const CHANGE_ORDER_STATUSES = [
  'Draft',
  'Awaiting Client',
  'Approved',
  'Rejected',
] as const;

export interface SelectionRecord {
  id: string;
  projectId: string;
  selectionName: string;
  category: string;
  roomOrArea: string;
  manufacturer: string;
  product: string;
  colorFinish: string;
  supplier: string;
  allowance: number | null;
  upgradeAmount: number | null;
  creditAmount: number | null;
  /** §9.3 — NEVER serialized into a client response. */
  actualCost: number | null;
  leadTime: string;
  approvalDeadline: string | null;
  status: string;
  clientDecision: string;
  clientComments: string;
  approvedDate: string | null;
  clientVisible: boolean;
  createdAt: string;
  createdBy: string | null;
}

export interface ChangeOrderRecord {
  id: string;
  projectId: string;
  changeOrderNumber: string;
  title: string;
  description: string;
  reason: string;
  requestedBy: string;
  addedCost: number;
  creditAmount: number;
  tax: number;
  scheduleImpactDays: number;
  revisedCompletionDate: string | null;
  approvalDeadline: string | null;
  paymentRequirement: string;
  status: string;
  clientComments: string;
  approvedBy: string;
  approvalDate: string | null;
  clientVisible: boolean;
  createdAt: string;
  createdBy: string | null;
}

/** Postgres numerics arrive as strings. A blank is null, never zero. */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): number {
  return num(value) ?? 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export class HubSelections {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private tenant(scope: TenantScope, context: string) {
    const contractorId = assertContractor(scope, context);
    return { filters: { contractor_id: `eq.${contractorId}` }, contractorId };
  }

  // ── Selections ────────────────────────────────────────────────────────────

  async listSelections(scope: TenantScope, projectId: string): Promise<SelectionRecord[]> {
    const { filters } = this.tenant(scope, 'selections');
    if (projectId.trim() === '') return [];

    const rows = await this.client.select<Record<string, unknown>>({
      from: 'hub_selections',
      filters: { ...filters, project_id: `eq.${projectId}`, archived_at: 'is.null' },
      order: 'created_at.desc',
      limit: 300,
    });

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      selectionName: text(r.selection_name),
      category: text(r.category),
      roomOrArea: text(r.room_or_area),
      manufacturer: text(r.manufacturer),
      product: text(r.product),
      colorFinish: text(r.color_finish),
      supplier: text(r.supplier),
      allowance: num(r.allowance),
      upgradeAmount: num(r.upgrade_amount),
      creditAmount: num(r.credit_amount),
      actualCost: num(r.actual_cost),
      leadTime: text(r.lead_time),
      approvalDeadline: (r.approval_deadline as string | null) ?? null,
      status: text(r.status) || 'Pending',
      clientDecision: text(r.client_decision),
      clientComments: text(r.client_comments),
      approvedDate: (r.approved_date as string | null) ?? null,
      clientVisible: r.client_visible === true,
      createdAt: String(r.created_at),
      createdBy: (r.created_by as string | null) ?? null,
    }));
  }

  async createSelection(
    scope: TenantScope,
    input: {
      projectId: string;
      selectionName: string;
      category?: string;
      roomOrArea?: string;
      allowance?: number | null;
      actualCost?: number | null;
      upgradeAmount?: number | null;
      status?: string;
    },
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'create selection');
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');
    if (input.selectionName.trim() === '') throw new TypeError('a selection needs a name');

    await this.client.insert({
      from: 'hub_selections',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          selection_name: input.selectionName.trim(),
          category: input.category?.trim() || null,
          room_or_area: input.roomOrArea?.trim() || null,
          allowance: input.allowance ?? null,
          actual_cost: input.actualCost ?? null,
          upgrade_amount: input.upgradeAmount ?? null,
          status: input.status ?? 'Pending',
          client_visible: false,
          created_by: actor.name,
        },
      ],
    });
  }

  async updateSelection(
    scope: TenantScope,
    selectionId: string,
    patch: {
      selectionName?: string;
      category?: string;
      roomOrArea?: string;
      allowance?: number | null;
      actualCost?: number | null;
      upgradeAmount?: number | null;
      status?: string;
      clientVisible?: boolean;
    },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'update selection');
    if (selectionId.trim() === '') throw new TypeError('selectionId is required');
    if (patch.selectionName !== undefined && patch.selectionName.trim() === '') {
      throw new TypeError('a selection needs a name');
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.selectionName !== undefined) values.selection_name = patch.selectionName.trim();
    if (patch.category !== undefined) values.category = patch.category.trim() || null;
    if (patch.roomOrArea !== undefined) values.room_or_area = patch.roomOrArea.trim() || null;
    if (patch.allowance !== undefined) values.allowance = patch.allowance;
    if (patch.actualCost !== undefined) values.actual_cost = patch.actualCost;
    if (patch.upgradeAmount !== undefined) values.upgrade_amount = patch.upgradeAmount;
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;

    await this.client.update({
      from: 'hub_selections',
      filters: { id: `eq.${selectionId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
  }

  async archiveSelection(
    scope: TenantScope,
    selectionId: string,
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive selection');
    if (selectionId.trim() === '') throw new TypeError('selectionId is required');

    await this.client.update({
      from: 'hub_selections',
      filters: { id: `eq.${selectionId}`, contractor_id: `eq.${contractorId}`, archived_at: 'is.null' },
      patch: {
        archived_at: new Date().toISOString(),
        archived_by: actor.name,
        updated_at: new Date().toISOString(),
      },
    });
  }

  // ── Change orders ─────────────────────────────────────────────────────────

  async listChangeOrders(scope: TenantScope, projectId: string): Promise<ChangeOrderRecord[]> {
    const { filters } = this.tenant(scope, 'change orders');
    if (projectId.trim() === '') return [];

    const rows = await this.client.select<Record<string, unknown>>({
      from: 'hub_change_orders',
      filters: { ...filters, project_id: `eq.${projectId}`, archived_at: 'is.null' },
      order: 'created_at.desc',
      limit: 300,
    });

    return rows.map((r) => ({
      id: String(r.id),
      projectId: String(r.project_id),
      changeOrderNumber: text(r.change_order_number),
      title: text(r.title),
      description: text(r.description),
      reason: text(r.reason),
      requestedBy: text(r.requested_by),
      addedCost: money(r.added_cost),
      creditAmount: money(r.credit_amount),
      tax: money(r.tax),
      scheduleImpactDays: num(r.schedule_impact_days) ?? 0,
      revisedCompletionDate: (r.revised_completion_date as string | null) ?? null,
      approvalDeadline: (r.approval_deadline as string | null) ?? null,
      paymentRequirement: text(r.payment_requirement),
      status: text(r.status) || 'Draft',
      clientComments: text(r.client_comments),
      approvedBy: text(r.approved_by),
      approvalDate: (r.approval_date as string | null) ?? null,
      clientVisible: r.client_visible === true,
      createdAt: String(r.created_at),
      createdBy: (r.created_by as string | null) ?? null,
    }));
  }

  async createChangeOrder(
    scope: TenantScope,
    input: {
      projectId: string;
      changeOrderNumber: string;
      title: string;
      description?: string;
      reason?: string;
      addedCost?: number;
      creditAmount?: number;
      scheduleImpactDays?: number;
      status?: string;
    },
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'create change order');
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');
    if (input.changeOrderNumber.trim() === '') throw new TypeError('a change order needs a number');
    if (input.title.trim() === '') throw new TypeError('a change order needs a title');

    // Negative money is a credit, and there is a column for that. A negative
    // `addedCost` would net out silently and misstate the contract.
    if ((input.addedCost ?? 0) < 0) throw new RangeError('added cost cannot be negative — use the credit field');
    if ((input.creditAmount ?? 0) < 0) throw new RangeError('a credit cannot be negative');

    await this.client.insert({
      from: 'hub_change_orders',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          change_order_number: input.changeOrderNumber.trim(),
          title: input.title.trim(),
          description: input.description?.trim() || null,
          reason: input.reason?.trim() || null,
          requested_by: actor.name,
          added_cost: input.addedCost ?? 0,
          credit_amount: input.creditAmount ?? 0,
          schedule_impact_days: input.scheduleImpactDays ?? 0,
          status: input.status ?? 'Draft',
          client_visible: false,
          created_by: actor.name,
        },
      ],
    });
  }

  async updateChangeOrder(
    scope: TenantScope,
    changeOrderId: string,
    patch: {
      title?: string;
      description?: string;
      reason?: string;
      addedCost?: number;
      creditAmount?: number;
      scheduleImpactDays?: number;
      status?: string;
      clientVisible?: boolean;
    },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'update change order');
    if (changeOrderId.trim() === '') throw new TypeError('changeOrderId is required');
    if (patch.title !== undefined && patch.title.trim() === '') {
      throw new TypeError('a change order needs a title');
    }
    if (patch.addedCost !== undefined && patch.addedCost < 0) {
      throw new RangeError('added cost cannot be negative — use the credit field');
    }
    if (patch.creditAmount !== undefined && patch.creditAmount < 0) {
      throw new RangeError('a credit cannot be negative');
    }

    const values: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) values.title = patch.title.trim();
    if (patch.description !== undefined) values.description = patch.description.trim() || null;
    if (patch.reason !== undefined) values.reason = patch.reason.trim() || null;
    if (patch.addedCost !== undefined) values.added_cost = patch.addedCost;
    if (patch.creditAmount !== undefined) values.credit_amount = patch.creditAmount;
    if (patch.scheduleImpactDays !== undefined) {
      values.schedule_impact_days = patch.scheduleImpactDays;
    }
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;

    await this.client.update({
      from: 'hub_change_orders',
      filters: { id: `eq.${changeOrderId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
  }

  async archiveChangeOrder(
    scope: TenantScope,
    changeOrderId: string,
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive change order');
    if (changeOrderId.trim() === '') throw new TypeError('changeOrderId is required');

    await this.client.update({
      from: 'hub_change_orders',
      filters: {
        id: `eq.${changeOrderId}`,
        contractor_id: `eq.${contractorId}`,
        archived_at: 'is.null',
      },
      patch: {
        archived_at: new Date().toISOString(),
        archived_by: actor.name,
        updated_at: new Date().toISOString(),
      },
    });
  }
}

/**
 * The client's view of a selection.
 *
 * `actualCost` is not dropped — it is never present. Built by literal rather
 * than by deleting a key, so a field added to `SelectionRecord` tomorrow cannot
 * appear here unless somebody adds it deliberately.
 */
export function clientSelection(selection: SelectionRecord) {
  return {
    id: selection.id,
    selectionName: selection.selectionName,
    category: selection.category,
    roomOrArea: selection.roomOrArea,
    manufacturer: selection.manufacturer,
    product: selection.product,
    colorFinish: selection.colorFinish,
    allowance: selection.allowance,
    upgradeAmount: selection.upgradeAmount,
    creditAmount: selection.creditAmount,
    leadTime: selection.leadTime,
    approvalDeadline: selection.approvalDeadline,
    status: selection.status,
    clientDecision: selection.clientDecision,
    // The homeowner's OWN words and their own approval date. Withholding these
    // would hide a client's decision from the client who made it.
    clientComments: selection.clientComments,
    approvedDate: selection.approvedDate,
  };
}

export type HubSelectionsResult =
  | { available: true; selections: HubSelections }
  | { available: false; missing: string[] };

export function getHubSelections(): HubSelectionsResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, selections: new HubSelections(hub.client) };
}
