import { budgetVisible, currentPortalProject, designSelectionsFor } from '@/lib/portal-data';
import { designSelectionTotals, selectedOption } from '@/lib/data/types';
import type { DesignOption, DesignSelection } from '@/lib/data/types';
import { Badge, Card, PortalEmpty } from '@/components/ui';

/**
 * Artifact 87 Designs & Selections — the client's half.
 *
 * Three things this screen has to get right:
 *
 * **A selection is a choice, not a bill.** The options and the client's decision
 * are shown even when pricing is hidden; only the dollar price impact is gated,
 * the same rule the budget uses (`budgetVisible`). A contractor who hides pricing
 * has not stopped the client from picking their tile.
 *
 * **The baseline is honest.** Every selection carries the allowance option at
 * $0, marked "Included", so an upgrade reads as a deliberate step up from what
 * was already in the scope — not a surprise line item.
 *
 * **Upgrades are not a competing total.** Confirmed upgrades are money over the
 * allowance and are captured through a change order; they are never folded into
 * the contract total, which would double-count against the Budget screen.
 *
 * PROVISIONAL: the actions post nowhere yet. The selection write-path is not
 * built — the buttons render disabled rather than wired to a no-op, so nothing
 * implies a choice was recorded that was not.
 */

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function statusTone(status: DesignSelection['status']): 'good' | 'warn' | 'neutral' {
  if (status === 'Confirmed') return 'good';
  if (status === 'Awaiting Your Selection' || status === 'Revision Requested') return 'warn';
  return 'neutral';
}

/** What the client is being asked to do, in their words rather than the status code. */
function statusLabel(status: DesignSelection['status']): string {
  if (status === 'Awaiting Your Selection') return 'Awaiting your choice';
  if (status === 'Selection Submitted') return 'Choice submitted';
  if (status === 'Revision Requested') return 'Revision requested';
  return status;
}

/** The price side of an option, gated. "Included" is a category, not a dollar figure. */
function priceLabel(option: DesignOption, showPricing: boolean): string {
  if (option.isBaseline || option.priceImpact === 0) return 'Included';
  if (!showPricing) return 'Upgrade';
  const sign = option.priceImpact > 0 ? '+' : '−';
  return `${sign}${money(Math.abs(option.priceImpact))}`;
}

function OptionRow({
  option,
  selected,
  showPricing,
}: {
  option: DesignOption;
  selected: boolean;
  showPricing: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 ${
        selected ? 'border-navy-900 bg-navy-50' : 'border-navy-100'
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {selected && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-navy-900"
              aria-label="Your choice"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
          <span className="text-sm font-medium text-navy-900">{option.name}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-navy-500">{option.detail}</p>
      </div>
      <span
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          option.isBaseline || option.priceImpact === 0 ? 'text-navy-400' : 'text-navy-900'
        }`}
      >
        {priceLabel(option, showPricing)}
      </span>
    </div>
  );
}

function SelectionCard({ sel, showPricing }: { sel: DesignSelection; showPricing: boolean }) {
  const chosen = selectedOption(sel);
  const awaiting = sel.status === 'Awaiting Your Selection' || sel.status === 'Revision Requested';

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-xs font-semibold tracking-wide text-navy-400">
              DS-{sel.selectionNumber}
            </span>
            <Badge tone={statusTone(sel.status)}>{statusLabel(sel.status)}</Badge>
          </div>
          <h2 className="mt-1.5 text-base font-semibold text-navy-900">{sel.title}</h2>
          <p className="mt-0.5 text-xs text-navy-400">
            {sel.category} · {sel.location}
          </p>
        </div>
        {awaiting && sel.decisionDeadline !== null && (
          <div className="text-right">
            <div className="text-xs tracking-wide text-navy-400 uppercase">Please choose by</div>
            <div className="mt-0.5 text-sm font-semibold text-navy-900">
              {longDate(sel.decisionDeadline)}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-navy-700">{sel.description}</p>

      <div className="mt-4 space-y-2">
        {sel.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            selected={chosen !== null && option.id === chosen.id}
            showPricing={showPricing}
          />
        ))}
      </div>

      {sel.clientComments !== '' && (
        <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700">
          <span className="font-medium">Your note:</span> {sel.clientComments}
        </p>
      )}

      {awaiting && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
          <button
            type="button"
            disabled
            className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Make your selection
          </button>
          <button
            type="button"
            disabled
            className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask a question
          </button>
          <span className="text-xs text-navy-400">Selections open in your secure portal account.</span>
        </div>
      )}

      {sel.status === 'Selection Submitted' && chosen !== null && (
        <p className="mt-4 border-t border-navy-100 pt-3 text-xs text-navy-400">
          You chose {chosen.name}. Awaiting your contractor&rsquo;s confirmation.
        </p>
      )}

      {sel.status === 'Confirmed' && chosen !== null && (
        <p className="mt-4 border-t border-navy-100 pt-3 text-xs text-navy-400">
          {chosen.name} confirmed
          {sel.decidedBy !== null && ` by ${sel.decidedBy}`}
          {sel.decidedDate !== null && ` on ${longDate(sel.decidedDate)}`}.
        </p>
      )}
    </Card>
  );
}

export default async function PortalDesigns({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const selections = designSelectionsFor(project);
  const showPricing = budgetVisible(project);
  const { confirmed } = designSelectionTotals(selections);
  const awaitingCount = selections.filter(
    (s) => s.status === 'Awaiting Your Selection' || s.status === 'Revision Requested',
  ).length;
  const confirmedCount = selections.filter((s) => s.status === 'Confirmed').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Designs &amp; Selections</h1>
        <p className="mt-1 text-sm text-navy-400">
          The materials and finishes to choose from, and what each one changes.
        </p>
      </div>

      {selections.length === 0 ? (
        <PortalEmpty
          title="No selections yet"
          body="Material and finish selections will appear here as your contractor prepares them, each with its options and any price impact before you decide."
        />
      ) : (
        <>
          <Card className="p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Selections</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {selections.length}
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">
                  Awaiting your choice
                </div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {awaitingCount === 0 ? '—' : awaitingCount}
                </div>
              </div>
              <div>
                <div className="text-xs tracking-wide text-navy-400 uppercase">Confirmed</div>
                <div className="mt-1 text-xl font-semibold tabular-nums text-navy-900">
                  {confirmedCount}
                </div>
              </div>
            </div>
            {showPricing && confirmed !== 0 && (
              <p className="mt-4 border-t border-navy-100 pt-3 text-sm text-navy-500">
                <span className="font-medium text-navy-700">
                  {money(confirmed)} in confirmed upgrades
                </span>{' '}
                over your original allowances. Upgrades are added to your contract through a change
                order — see the Change Orders screen.
              </p>
            )}
          </Card>

          <div className="space-y-4">
            {selections.map((sel) => (
              <SelectionCard key={sel.id} sel={sel} showPricing={showPricing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
