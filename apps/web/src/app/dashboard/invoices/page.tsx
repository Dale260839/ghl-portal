import { SubmitButton } from '@/components/submit-button';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { resolveContractor } from '@/lib/buildsuite/contractor-identity';
import { getHubInvoiceDrafts } from '@/lib/hub-db/invoice-drafts';
import { joinProposalsToProjects } from '@/lib/signed-work';
import { draftsForProposal, percentTotal, scheduleFor } from '@/lib/payment-schedule';
import { saveInvoiceDraft, createInvoiceOnRail } from '@/lib/actions';
import { Badge, Card, CardHeader, currency, shortDate } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';
import Link from 'next/link';

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
          Draft invoices from each signed contract&apos;s payment schedule.{' '}
          <Link
            href="/dashboard/invoices/sample"
            className="font-medium text-navy-700 underline underline-offset-2"
          >
            See how the review step works on sample data
          </Link>
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
    // "No signed contracts" and "signed contracts we cannot see" are different
    // facts, and showing the first when the second is true is exactly the kind
    // of silent empty state that has hidden real defects all week.
    //
    // On 2026-09-03 this is not hypothetical: all four signed proposals in the
    // database belong to THIS contractor and point at one project that returns
    // zero rows to our key, while 102 others are visible. Reporting "none" for
    // that would be false.
    const byContractor = await reader
      .listLive(scope, scope.contractorId)
      .catch(() => [] as typeof proposals);
    const visible = new Set(projects.map((p) => p.buildsuiteProjectId));
    const unreachable = byContractor.filter((p) => p.signed && !visible.has(p.projectId));

    return shell(
      <Card className="px-5 py-12 text-center">
        {unreachable.length === 0 ? (
          <>
            <p className="text-sm text-navy-600">No signed contracts yet.</p>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
              An invoice comes from a signed contract&apos;s payment schedule. Nothing is drafted
              until a proposal carries a signature.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-navy-600">
              {unreachable.length} signed{' '}
              {unreachable.length === 1 ? 'contract is' : 'contracts are'} attached to a project
              this sign-in cannot read.
            </p>
            <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-navy-400">
              The signature is real — it is on the proposal. The project it belongs to returns
              nothing to our database key, so there is no job to invoice against. That is a
              permissions setting in BuildSuite, not missing work, and it is the same row that
              has been invisible since 2026-08-31.
            </p>
            <p className="mx-auto mt-2 max-w-xl text-xs text-navy-400">
              Until it is readable, the invoice flow cannot be exercised on real data.
            </p>
          </>
        )}
      </Card>,
    );
  }

  // The document is read one proposal at a time: `content` is ~4.6KB of
  // markdown and is deliberately not part of the standard proposal columns.
  const sections = await Promise.all(
    signed.map(async (row) => {
      const proposal = row.proposal!;
      // BOTH schedule sources. Reading `content` alone showed zero lines for
      // any proposal whose schedule is structured JSON — which is 8 of 48,
      // including the signed record the pilot runs on.
      const schedule = await reader.readSchedule(
        scope,
        row.project.buildsuiteProjectId,
        proposal.id,
      );
      const stored = await hub.drafts.listForProposal(scope, proposal.id);
      return {
        row,
        proposal,
        lines: scheduleFor(schedule),
        drafts: draftsForProposal(schedule, proposal.amount),
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
              action={
                <div className="flex items-center gap-3">
                  {/* The contract this invoice bills against. A contractor
                      about to send a figure should be one click from the
                      document that agreed it. */}
                  {proposal.signedPdfUrl !== null && (
                    <a
                      href={proposal.signedPdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-navy-600 underline underline-offset-2 hover:text-navy-900"
                    >
                      Signed contract
                    </a>
                  )}
                  <Badge tone="good">Signed</Badge>
                </div>
              }
            />

            <div className="border-b border-navy-100 px-5 py-3 text-xs text-navy-500">
              <span className="font-medium text-navy-700">
                {row.project.buildsuiteProjectId}
              </span>
              {' · '}
              {proposal.amount === null ? (
                <span className="text-amber-700">
                  no contract total recorded ({proposal.priceText || 'no price'}) — that is a
                  range, not a figure, so amounts
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
                        <SubmitButton
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50 disabled:opacity-40"
                        >
                          Save
                        </SubmitButton>

                        <textarea
                          name="description"
                          defaultValue={saved?.description ?? draft.line.description}
                          rows={2}
                          placeholder="Payment terms shown on the invoice"
                          disabled={saved?.status === 'sent'}
                          className="rounded-lg border border-navy-200 px-3 py-2 text-sm sm:col-span-3"
                        />
                      </form>

                      {/* Creating the invoice in GoHighLevel. A separate form
                          from Save on purpose: saving is the contractor's own
                          notes, this reaches another system. */}
                      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-navy-100 pt-3">
                        {saved?.externalId ? (
                          <>
                            <Badge tone="good">In GoHighLevel</Badge>
                            <span className="text-xs text-navy-500">
                              {saved.externalId}
                              {saved.railCreatedAt !== null && ` · ${shortDate(saved.railCreatedAt)}`}
                            </span>
                            {saved.externalUrl !== null && (
                              <a
                                href={saved.externalUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-navy-700 underline"
                              >
                                Open it to send
                              </a>
                            )}
                          </>
                        ) : (
                          <form action={createInvoiceOnRail} className="flex items-center gap-3">
                            <input type="hidden" name="draftId" value={saved?.id ?? ''} />
                            <input type="hidden" name="proposalId" value={proposal.id} />
                            <SubmitButton
                              disabled={saved === undefined || saved.amount === null}
                              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700 disabled:opacity-40"
                            >
                              Create in GoHighLevel
                            </SubmitButton>
                            <span className="text-xs text-navy-400">
                              {saved === undefined
                                ? 'Save this line first.'
                                : saved.amount === null
                                  ? 'Enter an amount first.'
                                  : 'Creates a draft. You send it from GoHighLevel.'}
                            </span>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* There is still no Send button, and that is the design rather
                than an omission. "Create in GoHighLevel" makes a DRAFT there;
                a person opens it and clicks send, which is Chris's rule — the
                contractor adds a note first, and nothing reaches a homeowner
                without somebody deciding it should. */}
            <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
              Creating an invoice puts a draft in GoHighLevel. Nobody is emailed and nothing is
              charged until you open it there and send it.
            </p>
          </Card>
        );
      })}
    </div>,
  );
}
