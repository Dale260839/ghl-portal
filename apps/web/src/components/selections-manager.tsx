import {
  archiveChangeOrder,
  archiveSelection,
  createChangeOrder,
  createSelection,
  updateChangeOrder,
  updateSelection,
} from '@/lib/actions';
import { Badge, Card, CardHeader, InternalOnly, currency } from '@/components/ui';
import { ControlEmpty, VisibilityTag } from '@/components/control';
import {
  CHANGE_ORDER_STATUSES,
  SELECTION_STATUSES,
  type ChangeOrderRecord,
  type SelectionRecord,
} from '@/lib/hub-db/selections';

/**
 * The add-and-manage surfaces for selections (§6.5) and change orders (§6.6).
 *
 * ---------------------------------------------------------------------------
 * `actualCost` IS THE ONE FIELD ON THIS SCREEN A CLIENT MUST NEVER SEE
 *
 * It is §9.3 deny-list — what the contractor actually pays — and it is edited
 * right here, next to the allowance the homeowner does see. So it is wrapped in
 * `InternalOnly`, which marks it visually, and it is absent from
 * `clientSelection()` by construction rather than removed by a filter.
 *
 * The visual marker is not the enforcement. The enforcement is that the client
 * shape is built by literal and a guardrail fails if the field ever appears in
 * a client-facing projection. The marker is so a contractor reading their own
 * screen knows which number is theirs alone.
 * ---------------------------------------------------------------------------
 */

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

function unavailable(missing: string[]) {
  return (
    <ControlEmpty
      title="The Hub database is not connected"
      body={`Missing: ${missing.join(', ')}. Nothing can be listed or saved.`}
    />
  );
}

/** Blank means "not recorded", and reads as a dash rather than $0.00. */
function amount(value: number | null): string {
  return value === null ? '—' : currency(value);
}

export function SelectionsManager({
  projectId,
  selections,
  released,
  hub,
}: {
  projectId: string;
  selections: SelectionRecord[];
  released: boolean;
  hub: { available: boolean; missing: string[] };
}) {
  if (!hub.available) return unavailable(hub.missing);

  return (
    <>
      <Card>
        <CardHeader title="Add a selection" />
        <form action={createSelection} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="selectionName"
            required
            placeholder="What is being chosen, e.g. Kitchen faucet"
            className={`${FIELD} sm:col-span-2`}
          />
          <input name="category" placeholder="Category" className={FIELD} />
          <input name="roomOrArea" placeholder="Room or area" className={FIELD} />

          <label className="text-xs text-navy-500">
            Allowance
            <input name="allowance" inputMode="decimal" placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="text-xs text-navy-500">
            Upgrade
            <input name="upgradeAmount" inputMode="decimal" placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="text-xs text-amber-700">
            Actual cost <InternalOnly>internal</InternalOnly>
            <input name="actualCost" inputMode="decimal" placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <button
            type="submit"
            className="self-end rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
          >
            Add
          </button>
          <p className="text-xs text-navy-400 sm:col-span-4">
            Saved internal. Actual cost never reaches the client, released or not.
          </p>
        </form>
      </Card>

      {selections.length === 0 ? (
        <ControlEmpty title="No selections yet" body="Add the first selection for this project." />
      ) : (
        <div className="space-y-3">
          {selections.map((s) => (
            <Card key={s.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">{s.selectionName}</span>
                {s.category !== '' && <Badge tone="neutral">{s.category}</Badge>}
                <Badge tone={s.status === 'Approved' || s.status === 'Installed' ? 'good' : 'neutral'}>
                  {s.status}
                </Badge>
                <VisibilityTag shown={released && s.clientVisible} />
                <span className="ml-auto text-xs text-navy-400">
                  allowance {amount(s.allowance)} · upgrade {amount(s.upgradeAmount)}
                </span>
              </div>

              <form action={updateSelection} className="mt-3 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="selectionId" value={s.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <input
                  name="selectionName"
                  defaultValue={s.selectionName}
                  required
                  className={`${FIELD} sm:col-span-2`}
                />
                <input name="category" defaultValue={s.category} placeholder="Category" className={FIELD} />
                <select name="status" defaultValue={s.status} className={FIELD}>
                  {SELECTION_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>

                <input name="roomOrArea" defaultValue={s.roomOrArea} placeholder="Room or area" className={FIELD} />
                <input
                  name="allowance"
                  defaultValue={s.allowance ?? ''}
                  inputMode="decimal"
                  placeholder="Allowance"
                  className={FIELD}
                />
                <input
                  name="upgradeAmount"
                  defaultValue={s.upgradeAmount ?? ''}
                  inputMode="decimal"
                  placeholder="Upgrade"
                  className={FIELD}
                />
                <input
                  name="actualCost"
                  defaultValue={s.actualCost ?? ''}
                  inputMode="decimal"
                  placeholder="Actual cost — internal"
                  className={`${FIELD} border-amber-600/40 bg-amber-soft`}
                />

                <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
                  <label className="flex items-center gap-2 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={s.clientVisible}
                      className="rounded border-navy-300"
                    />
                    Show this selection to the client
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Save
                  </button>
                </div>
              </form>

              <form action={archiveSelection} className="mt-2 border-t border-navy-100 pt-2">
                <input type="hidden" name="selectionId" value={s.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                  Remove selection
                </button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export function ChangeOrdersManager({
  projectId,
  orders,
  released,
  hub,
}: {
  projectId: string;
  orders: ChangeOrderRecord[];
  released: boolean;
  hub: { available: boolean; missing: string[] };
}) {
  if (!hub.available) return unavailable(hub.missing);

  const nextNumber = `CO-${orders.length + 1}`;

  return (
    <>
      <Card>
        <CardHeader title="Raise a change order" />
        <form action={createChangeOrder} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input
            name="changeOrderNumber"
            required
            defaultValue={nextNumber}
            className={FIELD}
            // Numbered per project, not globally: "CO-3" means the third on
            // THIS job, which is what both parties say out loud.
          />
          <input
            name="title"
            required
            placeholder="What is changing"
            className={`${FIELD} sm:col-span-2`}
          />
          <select name="status" defaultValue="Draft" className={FIELD}>
            {CHANGE_ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <label className="text-xs text-navy-500">
            Added cost
            <input name="addedCost" inputMode="decimal" placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="text-xs text-navy-500">
            Credit
            <input name="creditAmount" inputMode="decimal" placeholder="0.00" className={`${FIELD} mt-1 w-full`} />
          </label>
          <label className="text-xs text-navy-500">
            Schedule impact (days)
            <input name="scheduleImpactDays" type="number" defaultValue={0} className={`${FIELD} mt-1 w-full`} />
          </label>
          <button
            type="submit"
            className="self-end rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
          >
            Add
          </button>

          <textarea
            name="description"
            rows={2}
            placeholder="What the change involves"
            className={`${FIELD} sm:col-span-2`}
          />
          <textarea
            name="reason"
            rows={2}
            placeholder="Why it is needed"
            className={`${FIELD} sm:col-span-2`}
          />
          <p className="text-xs text-navy-400 sm:col-span-4">
            {/* A credit is its own field, so a negative cost is refused rather
                than netting out silently and misstating the contract. */}
            Saved internal. Enter a reduction as a credit, not a negative cost.
          </p>
        </form>
      </Card>

      {orders.length === 0 ? (
        <ControlEmpty title="No change orders" body="Nothing has changed on this project yet." />
      ) : (
        <div className="space-y-3">
          {orders.map((c) => (
            <Card key={c.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">
                  {c.changeOrderNumber} · {c.title}
                </span>
                <Badge
                  tone={
                    c.status === 'Approved' ? 'good' : c.status === 'Rejected' ? 'bad' : 'neutral'
                  }
                >
                  {c.status}
                </Badge>
                <VisibilityTag shown={released && c.clientVisible} />
                <span className="ml-auto text-xs tabular text-navy-400">
                  {currency(c.addedCost)}
                  {c.creditAmount > 0 && ` less ${currency(c.creditAmount)} credit`}
                  {c.scheduleImpactDays !== 0 && ` · ${c.scheduleImpactDays}d`}
                </span>
              </div>

              <form action={updateChangeOrder} className="mt-3 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="changeOrderId" value={c.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <input
                  name="title"
                  defaultValue={c.title}
                  required
                  className={`${FIELD} sm:col-span-2`}
                />
                <select name="status" defaultValue={c.status} className={FIELD}>
                  {CHANGE_ORDER_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                <input
                  name="scheduleImpactDays"
                  type="number"
                  defaultValue={c.scheduleImpactDays}
                  className={FIELD}
                />
                <input
                  name="addedCost"
                  defaultValue={c.addedCost}
                  inputMode="decimal"
                  placeholder="Added cost"
                  className={`${FIELD} sm:col-span-2`}
                />
                <input
                  name="creditAmount"
                  defaultValue={c.creditAmount}
                  inputMode="decimal"
                  placeholder="Credit"
                  className={`${FIELD} sm:col-span-2`}
                />
                <textarea
                  name="description"
                  defaultValue={c.description}
                  rows={2}
                  placeholder="What the change involves"
                  className={`${FIELD} sm:col-span-2`}
                />
                <textarea
                  name="reason"
                  defaultValue={c.reason}
                  rows={2}
                  placeholder="Why it is needed"
                  className={`${FIELD} sm:col-span-2`}
                />

                <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
                  <label className="flex items-center gap-2 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={c.clientVisible}
                      className="rounded border-navy-300"
                    />
                    Send this to the client for approval
                  </label>
                  <button
                    type="submit"
                    className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Save
                  </button>
                </div>
              </form>

              <form action={archiveChangeOrder} className="mt-2 border-t border-navy-100 pt-2">
                <input type="hidden" name="changeOrderId" value={c.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <button type="submit" className="text-xs font-medium text-red-700 hover:underline">
                  Withdraw change order
                </button>
              </form>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
