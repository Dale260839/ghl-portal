import { locationForAuthProfiles } from '@/lib/buildsuite/profile-location';
import { requireAccess } from '@/lib/access';
import { currentPortalProject, paymentScheduleForClient } from '@/lib/portal-data';
import {
  clientScheduleSummary,
  type ClientLineState,
  type ClientScheduleLine,
} from '@/lib/client-payment-schedule';
import { getInvoices, forClient, isIssued, totalInvoices, type ClientInvoice } from '@/lib/ghl/invoices';
import { Badge, Card, CardHeader, PortalEmpty, currency, shortDate } from '@/components/ui';

const LINE_STATE: Record<ClientLineState, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  paid: { label: 'Paid', tone: 'good' },
  due: { label: 'Invoiced', tone: 'warn' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
};

/**
 * What the homeowner will pay, and when — from the contract they signed.
 *
 * Chris, huddle 2026-09-10. Every figure here is either the contract's own or
 * an issued invoice's; see `lib/client-payment-schedule.ts` for why nothing
 * else is allowed to reach this card.
 */
function PaymentScheduleCard({ lines }: { lines: ClientScheduleLine[] }) {
  const summary = clientScheduleSummary(lines);
  return (
    <Card>
      <CardHeader title="Payment schedule" />
      <div className="grid gap-3 border-b border-navy-100 px-5 py-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">
            Next payment
          </div>
          {summary.next === null ? (
            <div className="mt-1 text-sm font-semibold text-emerald-700">All paid — thank you</div>
          ) : (
            <div className="mt-1 text-sm text-navy-900">
              <span className="font-semibold">{summary.next.title}</span>
              {' · '}
              <span className="tabular">
                {summary.next.amount === null ? 'amount to be confirmed' : currency(summary.next.amount)}
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">
            Still to come
          </div>
          <div className="tabular mt-1 text-sm font-semibold text-navy-900">
            {currency(summary.upcomingTotal)}
            {summary.upcomingUnpriced > 0 && (
              <span className="ml-1.5 text-xs font-normal text-navy-400">
                + {summary.upcomingUnpriced} to be confirmed
              </span>
            )}
          </div>
        </div>
      </div>

      <ol className="divide-y divide-navy-100">
        {lines.map((line) => (
          <li key={line.order} className="flex items-start justify-between gap-4 px-5 py-3.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">{line.title}</span>
                {line.percent !== null && (
                  <span className="text-xs text-navy-400">{line.percent}%</span>
                )}
                <Badge tone={LINE_STATE[line.state].tone}>{LINE_STATE[line.state].label}</Badge>
              </div>
              {line.description !== '' && (
                <p className="mt-0.5 text-xs leading-relaxed text-navy-500">{line.description}</p>
              )}
            </div>
            <div className="tabular shrink-0 text-right text-sm font-semibold text-navy-900">
              {line.amount === null ? (
                <span className="text-xs font-normal text-navy-400">To be confirmed</span>
              ) : (
                currency(line.amount)
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
        From your signed contract. A stage shows as Invoiced once your contractor issues its
        invoice, and Paid once it is settled.
      </p>
    </Card>
  );
}

/**
 * Payments and invoices, for the homeowner.
 *
 * Chris settled the rail on 2026-09-01: GoHighLevel, not Stripe. Invoicing was
 * already live on the account — real invoices, real templates — and the Projects
 * custom object already carries `amount_invoiced` and `amount_paid`, so the
 * money belongs beside the operational record rather than in a second system.
 *
 * ---------------------------------------------------------------------------
 * WHAT A HOMEOWNER SEES HERE, AND WHAT THEY DO NOT
 *
 * The permission matrix grants `invoice` to the contractor alone, and that stays
 * true — the note beside it says a client reads their own invoice "through the
 * portal's gated projection, not through this resource", and this is that
 * projection.
 *
 * `forClient` drops the contractor's own fields by construction rather than
 * blanking them, so a response cannot carry a bank detail or a staff name even
 * if a future screen tried to render one.
 *
 * **Drafts never appear.** A draft is the contractor still deciding. Showing a
 * homeowner a figure nobody has issued is how an argument starts about a price
 * that was never quoted.
 * ---------------------------------------------------------------------------
 */

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'neutral'> = {
  paid: 'good',
  sent: 'warn',
  partially_paid: 'warn',
  overdue: 'bad',
  void: 'neutral',
};

function isOverdue(invoice: ClientInvoice, today: string): boolean {
  return invoice.amountDue > 0 && invoice.dueDate !== null && invoice.dueDate.slice(0, 10) < today;
}

export default async function Payments({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  // Access, not just a session: a revoked homeowner is out on this request.
  await requireAccess();

  const shell = (children: React.ReactNode) => (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Payments &amp; Invoices
        </h1>
        <p className="mt-1 text-sm text-navy-400">
          What you will pay, and what has been billed, for this project.
        </p>
      </div>
      {children}
    </div>
  );

  // THE project on screen — through `currentPortalProject`, like every other
  // portal page. This page used to resolve its own: the FIRST project the
  // homeowner held, and every contact across all of them. So `?project=` was
  // ignored for a homeowner with two jobs, and a contractor's `?preview=` fell
  // through to no contact at all and showed "No invoices yet".
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return shell(<PortalEmpty title="No project" body="Nothing is shared with this account yet." />);
  }

  // Invoices for THIS project's contact, from its owner's sub-account. A
  // missing contact means no invoices — never an unfiltered list.
  let invoices: ClientInvoice[] = [];
  let invoiceProblem: 'none' | 'not-connected' | 'unreachable' = 'none';
  const ownerLocation =
    project.ownerAuthProfileId.trim() === ''
      ? null
      : await locationForAuthProfiles([project.ownerAuthProfileId]);
  const reader = getInvoices(ownerLocation);
  const contact = project.primaryContactId.trim();

  if (!reader.available) {
    invoiceProblem = 'not-connected';
  } else if (contact !== '') {
    try {
      const all = await reader.invoices.list();
      invoices = all
        .filter((i) => i.contactId === contact)
        .filter(isIssued)
        .map(forClient);
    } catch {
      // A billing system being unreachable is not something to explain to a
      // homeowner in error-speak. The schedule below still shows.
      invoiceProblem = 'unreachable';
    }
  }

  // The schedule from the signed contract. Given the ISSUED invoices only, so a
  // stage can be marked billed by id and never by a draft.
  const schedule = await paymentScheduleForClient(project, invoices);

  if (schedule.lines.length === 0 && invoices.length === 0) {
    return shell(
      invoiceProblem === 'unreachable' ? (
        <PortalEmpty
          title="We can't load your invoices right now"
          body="This is on our side, not yours. Please try again shortly, or ask your contractor."
        />
      ) : invoiceProblem === 'not-connected' ? (
        <PortalEmpty
          title="Not available yet"
          body="Invoices are handled directly by your contractor for now. They will appear here once billing is connected."
        />
      ) : (
        <PortalEmpty
          title="No invoices yet"
          body="Nothing has been billed on this project so far. Invoices appear here as soon as they are issued."
        />
      ),
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const totals = totalInvoices(
    invoices.map((i) => ({ ...i, contactId: null, contactName: '' })),
  );

  return shell(
    <>
      {schedule.lines.length > 0 && <PaymentScheduleCard lines={schedule.lines} />}

      {invoices.length === 0 ? (
        <p className="text-sm text-navy-500">
          {invoiceProblem === 'unreachable'
            ? "We can't load your invoices right now. The schedule above is from your signed contract."
            : 'No invoices have been issued yet. Each stage above is billed as the work reaches it.'}
        </p>
      ) : (
      <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Invoiced</div>
          <div className="tabular mt-1.5 text-2xl font-semibold text-navy-900">
            {currency(totals.invoiced)}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Paid</div>
          <div className="tabular mt-1.5 text-2xl font-semibold text-emerald-600">
            {currency(totals.paid)}
          </div>
        </Card>
        <Card className="px-5 py-4">
          <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">
            Outstanding
          </div>
          <div
            className={`tabular mt-1.5 text-2xl font-semibold ${
              totals.outstanding > 0 ? 'text-amber-accent' : 'text-navy-900'
            }`}
          >
            {currency(totals.outstanding)}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Your invoices" />
        <ul className="divide-y divide-navy-100">
          {invoices.map((invoice) => {
            const overdue = isOverdue(invoice, today);
            return (
              <li key={invoice.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-900">
                        {invoice.title === '' ? `Invoice ${invoice.invoiceNumber}` : invoice.title}
                      </span>
                      <Badge tone={overdue ? 'bad' : (STATUS_TONE[invoice.status] ?? 'neutral')}>
                        {overdue ? 'Overdue' : invoice.status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-400">
                      {invoice.invoiceNumber !== '' && <span>#{invoice.invoiceNumber}</span>}
                      {invoice.issueDate !== null && (
                        <span>issued {shortDate(invoice.issueDate.slice(0, 10))}</span>
                      )}
                      {invoice.dueDate !== null && (
                        <span>due {shortDate(invoice.dueDate.slice(0, 10))}</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-sm font-semibold text-navy-900">
                      {currency(invoice.total)}
                    </div>
                    {invoice.amountDue > 0 && (
                      <div className="tabular mt-0.5 text-xs text-amber-700">
                        {currency(invoice.amountDue)} due
                      </div>
                    )}
                  </div>
                </div>

                {invoice.items.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t border-navy-100 pt-2.5">
                    {invoice.items.map((item, n) => (
                      <li key={n} className="flex justify-between gap-4 text-xs text-navy-600">
                        <span className="min-w-0 truncate">
                          {item.name}
                          {item.quantity > 1 && ` × ${item.quantity}`}
                        </span>
                        <span className="tabular shrink-0">{currency(item.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      </>
      )}

      <p className="text-xs leading-relaxed text-navy-400">
        Invoices are issued by your contractor. If something here looks wrong, message them
        through the portal rather than paying it — it is quicker to fix before payment than
        after.
      </p>
    </>,
  );
}
