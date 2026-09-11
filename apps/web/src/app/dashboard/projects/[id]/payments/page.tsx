import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubInvoiceDrafts, type StoredInvoiceDraft } from '@/lib/hub-db/invoice-drafts';
import { getInvoices, isIssued, totalInvoices, type Invoice } from '@/lib/ghl/invoices';
import { Badge, Card, CardHeader, StatTile, currency, shortDate } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';
import { ControlEmpty, ControlHeader, ControlNote } from '@/components/control';

/**
 * Payments — the contractor's money tab for one project, on real data.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS USED TO BE
 *
 * A fixture list. `PAYMENT_SCHEDULE` filtered by project id, four stat tiles
 * computed from it, and a "Create invoice" button with no handler. It looked
 * finished and every figure on it was invented. Chris asked on 10 Sep for the
 * money tabs to be real, and a screen that shows a contractor a contract value
 * nobody agreed is worse than a screen that shows nothing.
 *
 * TWO SECTIONS, BECAUSE THERE ARE TWO TRUTHS
 *
 *   Invoice drafts    what the Hub holds: a line per instalment, with whatever
 *                     the contractor has supplied so far. Nobody has been
 *                     billed for any of these.
 *   Issued in GHL     what GoHighLevel says actually went out, and what came
 *                     back. This is the only place a paid figure can come from,
 *                     because the Hub never takes money.
 *
 * A draft carrying a GoHighLevel id sits in BOTH: it exists there, as a draft
 * somebody still has to send. That is the point of the badge rather than
 * merging the two lists into one apparent timeline.
 * ---------------------------------------------------------------------------
 */

/** A draft's own status, in the contractor's words rather than the column's. */
const DRAFT_TONE: Record<string, 'good' | 'warn' | 'neutral'> = {
  sent: 'good',
  ready: 'warn',
  draft: 'neutral',
  void: 'neutral',
};

/** GHL's status vocabulary is its own and grows; anything unknown reads neutral. */
const INVOICE_TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = {
  paid: 'good',
  sent: 'warn',
  partially_paid: 'warn',
  overdue: 'bad',
  void: 'neutral',
  draft: 'neutral',
};

function draftAmount(draft: StoredInvoiceDraft) {
  // Null stays null. A zero here is a figure a contractor could act on.
  return draft.amount === null ? (
    <span className="text-amber-700">Amount needed</span>
  ) : (
    <span className="font-medium text-navy-900">{currency(draft.amount)}</span>
  );
}

export default async function ProjectPaymentsControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const header = (
    <ControlHeader
      title="Payments"
      subtitle="Every invoice raised against this project, and what GoHighLevel says about it."
      clientHref={`/portal/payments?preview=${id}`}
    />
  );

  // Everything the Hub stores is filed under a contractor id, and a session
  // that resolves to none must be shown nothing rather than another company's
  // invoices. Same refusal as the schedule screen, said in words.
  if (scope.contractorId === undefined) {
    return (
      <div className="space-y-6">
        {header}
        <NotLinkedToContractor what="Payments" />
      </div>
    );
  }

  const hub = getHubInvoiceDrafts();
  const drafts = hub.available ? await hub.drafts.listForProject(scope, id) : [];

  // ── What GoHighLevel holds ────────────────────────────────────────────────
  //
  // Read defensively. GHL being unconfigured or briefly unreachable is not a
  // failure of this screen: the drafts above are still worth showing, so a
  // calm note beats an error page over a section that is one of two.
  const ghl = getInvoices(scope.locationId);
  let issued: Invoice[] = [];
  let ghlNote: string | null = null;

  if (!ghl.available) {
    ghlNote = `GoHighLevel is not connected here, so issued invoices cannot be read. Missing: ${ghl.missing.join(', ')}.`;
  } else {
    try {
      const all = await ghl.invoices.list();
      // Two joins, because a GHL invoice carries no project field. The
      // reference the rail stamps on the name carries the project code, and
      // the contact is what the invoice is actually attached to. Either is
      // enough; neither alone covers an invoice raised by hand in GHL.
      const code = project.projectCode;
      const contactId = project.primaryContactId.trim();
      issued = all.filter(
        (invoice) =>
          (code !== null && code !== '' && invoice.title.includes(code)) ||
          (contactId !== '' && invoice.contactId === contactId),
      );
    } catch {
      // The message would be a GHL URL and a status code, which tells a
      // contractor nothing they can act on.
      ghlNote = 'GoHighLevel could not be reached just now, so issued invoices are not shown.';
    }
  }

  const onlyIssued = issued.filter(isIssued);
  const totals = onlyIssued.length === 0 ? null : totalInvoices(onlyIssued);

  return (
    <div className="space-y-6">
      {header}

      <ControlNote>
        Invoices are drafted from the signed contract&rsquo;s payment schedule on the{' '}
        <Link href="/dashboard/invoices" className="font-medium text-navy-900 underline underline-offset-2">
          Invoices screen
        </Link>
        . Creating one puts a draft in GoHighLevel; nobody is emailed and nothing is charged until a
        person opens it there and sends it.
      </ControlNote>

      {totals !== null && (
        <div className="grid gap-3 sm:grid-cols-4">
          <StatTile label="Invoiced" value={currency(totals.invoiced)} sub="Issued in GoHighLevel" />
          <StatTile label="Paid" value={currency(totals.paid)} tone="good" />
          <StatTile label="Outstanding" value={currency(totals.outstanding)} />
          <StatTile
            label="Overdue"
            value={currency(totals.overdue)}
            tone={totals.overdue > 0 ? 'warn' : 'default'}
          />
        </div>
      )}

      {/* ── Section A · the Hub's drafts ─────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Invoice drafts"
          action={
            <Link
              href="/dashboard/invoices"
              className="text-xs font-medium text-navy-700 underline underline-offset-2 hover:text-navy-900"
            >
              Draft a new one
            </Link>
          }
        />
        {!hub.available ? (
          <p className="px-5 py-8 text-center text-xs text-navy-400">
            The Hub database is not connected, so drafts cannot be read. Missing:{' '}
            {hub.missing.join(', ')}.
          </p>
        ) : drafts.length === 0 ? (
          <ControlEmpty
            title="No drafts yet"
            body="Drafts appear once this project's signed contract has been opened on the Invoices screen."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs tracking-wide text-navy-400 uppercase">
                  <th className="px-5 py-3 font-medium">Line</th>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">GoHighLevel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {drafts.map((draft) => (
                  <tr key={draft.id}>
                    <td className="px-5 py-3 text-navy-500">
                      {draft.lineOrder === 1 ? 'Deposit · 1' : draft.lineOrder}
                    </td>
                    <td className="px-5 py-3">
                      {draft.title !== null && draft.title !== '' ? (
                        <span className="font-medium text-navy-900">{draft.title}</span>
                      ) : (
                        <span className="text-navy-400">No title yet</span>
                      )}
                      {draft.description !== null && draft.description !== '' && (
                        <div className="text-xs text-navy-400">{draft.description}</div>
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right">{draftAmount(draft)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={DRAFT_TONE[draft.status] ?? 'neutral'}>{draft.status}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {draft.externalId === null ? (
                        <span className="text-navy-300">Not created yet</span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone="good">In GoHighLevel</Badge>
                          {draft.externalUrl !== null ? (
                            <a
                              href={draft.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-navy-700 underline underline-offset-2"
                            >
                              Open it to send
                            </a>
                          ) : (
                            <span className="text-navy-500">{draft.externalId}</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Section B · what GoHighLevel actually issued ──────────────────── */}
      <Card>
        <CardHeader title="Issued in GoHighLevel" />
        {ghlNote !== null ? (
          <p className="px-5 py-8 text-center text-xs text-navy-400">{ghlNote}</p>
        ) : onlyIssued.length === 0 ? (
          <ControlEmpty
            title="Nothing issued yet"
            body="No invoice for this project has been sent from GoHighLevel. Drafts sitting there do not count until somebody sends them."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs tracking-wide text-navy-400 uppercase">
                  <th className="px-5 py-3 font-medium">Number</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                  <th className="px-5 py-3 text-right font-medium">Paid</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {onlyIssued.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-5 py-3">
                      <div className="font-medium text-navy-900">
                        {invoice.invoiceNumber !== '' ? invoice.invoiceNumber : invoice.id}
                      </div>
                      {invoice.title !== '' && (
                        <div className="text-xs text-navy-400">{invoice.title}</div>
                      )}
                    </td>
                    <td className="tabular px-5 py-3 text-right font-medium text-navy-900">
                      {currency(invoice.total)}
                    </td>
                    <td className="tabular px-5 py-3 text-right text-navy-900">
                      {currency(invoice.amountPaid)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={INVOICE_TONE[invoice.status] ?? 'neutral'}>
                        {invoice.status}
                      </Badge>
                      <div className="mt-1 text-xs text-navy-400">
                        {invoice.amountDue > 0
                          ? `${currency(invoice.amountDue)} unpaid`
                          : 'Paid in full'}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs text-navy-500">
                      {invoice.dueDate === null ? (
                        <span className="text-navy-300">No due date</span>
                      ) : (
                        shortDate(invoice.dueDate.slice(0, 10))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
