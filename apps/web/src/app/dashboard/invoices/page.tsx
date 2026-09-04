import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { resolveContractor } from '@/lib/buildsuite/contractor-identity';
import { getHubInvoiceDrafts } from '@/lib/hub-db/invoice-drafts';
import { joinProposalsToProjects } from '@/lib/signed-work';
import { paymentScheduleDrafts, percentTotal, parsePaymentSchedule } from '@/lib/payment-schedule';
import { saveInvoiceDraft } from '@/lib/actions';
import { Badge, Card, CardHeader, currency } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';

/**
 * Invoice review — where an invoice actually gets its numbers.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SCREEN IS THE PRODUCT AND NOT A CONFIRMATION STEP
 *
 * Chris's flow reads as: the signed contract creates a draft from the first
 * payment-schedule line, the contractor reviews it, then sends. That implies
 * the draft arrives complete and review is a formality.
 *
 * The data says otherwise. Measured across all 46 proposals on 2026-09-03:
 * 125 schedule lines, every one carrying a percent, only 35 carrying a dollar
 * amount. And for **all four signed proposals** — the exact pilot path — there
 * is no amount and no title, because `proposals.total` is null and
 * `proposals.price` is a band string like "$2,000 - $5,000".
 *
 * So the contractor is not confirming a number. They are supplying it. This
 * screen is built around that: it shows what the proposal said, says plainly
 * what it could not supply, and asks for the rest.
 * ---------------------------------------------------------------------------
 *
 * Nothing here sends. The send is still gated on the rail decision, and the
 * review work is stored so it survives whichever rail is chosen.
 */

export default async function Invoices() {
  const scope = await requireTenantScope();
  const reader = getProposalsReader();
  const hub = getHubInvoiceDrafts();

  const shell = (children: React.ReactNode) => (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Invoices</h1>
        <p className="mt-1 text-sm text-navy-400">
          Draft invoices from each signed contract&apos;s payment schedule.
        </p>
      </div>
      {children}
    </div>
  );

  if (!reader.available || !hub.available) {
    const missing = [
      ...(reader.available ? [] : reader.missing),
      ...(hub.available ? [] : hub.missing),
    ];
    return shell(
      <Card className="px-5 py-10 text-center">
        <p className="text-sm text-navy-600">Not connected.</p>
        <p className="mt-1.5 text-xs text-navy-400">Missing: {missing.join(', ')}</p>
      </Card>,
    );
  }

  const identity = await resolveContractor(scope);
  if (!identity.resolved || scope.contractorId === undefined) {
    return shell(<NotLinkedToContractor what="Invoices" />);
  }

  const projects = await (await currentDataSource(scope)).listProjects(scope);
  const proposals = await reader.listForProjects(
    scope,
    projects.map((p) => p.buildsuiteProjectId),
  );

  // Signed only. An invoice against an unsigned proposal is a bill for work
  // nobody has agreed to.
  const signed = joinProposalsToProjects(projects, proposals).filter(
    (row) => row.status === 'signed' && row.proposal !== null,
  );

  if (signed.length === 0) {
    return shell(
      <Card className="px-5 py-12 text-center">
        <p className="text-sm text-navy-600">No signed contracts yet.</p>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
          An invoice comes from a signed contract&apos;s payment schedule. Nothing is drafted
          until a proposal carries a signature.
        </p>
      </Card>,
    );
  }

  // The document is read one proposal at a time: `content` is ~4.6KB of
  // markdown and is deliberately not part of the standard proposal columns.
  const sections = await Promise.all(
    signed.map(async (row) => {
      const proposal = row.proposal!;
      const content = await reader.readContent(
        scope,
        row.project.buildsuiteProjectId,
        proposal.id,
      );
      const stored = await hub.drafts.listForProposal(scope, proposal.id);
      return {
        row,
        proposal,
        lines: parsePaymentSchedule(content),
        drafts: paymentScheduleDrafts(content, proposal.amount),
        stored,
      };
    }),
  );

  return shell(
    <div className="space-y-6">
      {sections.map(({ row, proposal, lines, drafts, stored }) => {
        const byLine = new Map(stored.map((d) => [d.lineOrder, d]));
        const pct = percentTotal(lines);

        return (
          <Card key={proposal.id}>
            <CardHeader
              title={row.project.projectName}
              action={<Badge tone="good">Signed</Badge>}
            />

            <div className="border-b border-navy-100 px-5 py-3 text-xs text-navy-500">
              <span className="font-medium text-navy-700">
                {row.project.buildsuiteProjectId}
              </span>
              {' · '}
              {proposal.amount === null ? (
                <span className="text-amber-700">
                  no contract total recorded ({proposal.priceText || 'no price'}) — amounts
                  cannot be calculated from a percent
                </span>
              ) : (
                <>contract {currency(proposal.amount)}</>
              )}
              {pct !== null && pct !== 100 && (
                <span className="text-amber-700"> · schedule totals {pct}%, not 100%</span>
              )}
            </div>

            {drafts.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-navy-400">
                This contract has no payment schedule to invoice from. Add one to the proposal in
                BuildSuite, or raise the invoice manually.
              </p>
            ) : (
              <ul className="divide-y divide-navy-100">
                {drafts.map((draft) => {
                  const saved = byLine.get(draft.line.order);
                  const amount = saved?.amount ?? draft.amount;
                  const title = saved?.title ?? draft.line.title;

                  return (
                    <li key={draft.line.order} className="px-5 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-navy-500">
                          {draft.line.order === 1
                            ? 'Deposit · line 1'
                            : `Milestone · line ${draft.line.order}`}
                        </span>
                        {saved?.status === 'sent' && <Badge tone="good">Sent</Badge>}
                      </div>

                      {/* What the proposal said, verbatim. A contractor
                          correcting a number should be able to see what was
                          parsed rather than trusting the parse. */}
                      <p className="mt-1 font-mono text-xs break-words text-navy-400">
                        {draft.line.raw}
                      </p>

                      {draft.warnings.length > 0 && saved?.amount == null && (
                        <ul className="mt-2 space-y-1">
                          {draft.warnings.map((w) => (
                            <li key={w} className="text-xs text-amber-700">
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}

                      <form
                        action={saveInvoiceDraft}
                        className="mt-3 grid gap-2 sm:grid-cols-[1fr_10rem_auto]"
                      >
                        <input type="hidden" name="projectId" value={row.project.buildsuiteProjectId} />
                        <input type="hidden" name="proposalId" value={proposal.id} />
                        <input type="hidden" name="lineOrder" value={draft.line.order} />

                        <input
                          name="title"
                          defaultValue={title ?? ''}
                          placeholder="What this invoice is for"
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
                        />
                        <input
                          name="amount"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={amount ?? ''}
                          placeholder="Amount"
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
                        />
                        <button
                          type="submit"
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-40"
                        >
                          Save
                        </button>

                        <textarea
                          name="description"
                          defaultValue={saved?.description ?? draft.line.description}
                          rows={2}
                          placeholder="Payment terms shown on the invoice"
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-3 py-2 text-sm sm:col-span-3"
                        />
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Deliberately no Send button. The rail — GoHighLevel invoicing or
                Stripe — is still an open decision, and a button that cannot
                send is worse than no button. The review above is stored, so
                none of this work is lost whichever way it goes. */}
            <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
              Sending is not wired yet — the invoicing rail is still being decided. Everything
              entered here is saved and will carry across.
            </p>
          </Card>
        );
      })}
    </div>,
  );
}
