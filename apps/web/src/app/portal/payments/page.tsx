import { requireAccess } from '@/lib/access';
import { currentDataSource } from '@/lib/data/current-source';
import { getInvoices, forClient, isIssued, totalInvoices, type ClientInvoice } from '@/lib/ghl/invoices';
import { Badge, Card, CardHeader, PortalEmpty, currency, shortDate } from '@/components/ui';

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

export default async function Payments() {
  const { session } = await requireAccess();
  const contactId = session.contactId;

  const shell = (children: React.ReactNode) => (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Payments &amp; Invoices
        </h1>
        <p className="mt-1 text-sm text-navy-400">Your invoices for this project.</p>
      </div>
      {children}
    </div>
  );

  const reader = getInvoices();
  if (!reader.available || contactId === undefined) {
    return shell(
      <PortalEmpty
        title="Not available yet"
        body="Invoices are handled directly by your contractor for now. They will appear here once billing is connected."
      />,
    );
  }

  // The join runs through the project, not the session: a homeowner's portal
  // identity is not a GoHighLevel contact, but the project they are on knows
  // which contact it bills.
  const db = await currentDataSource();
  const projects = await db.listProjectsForContact(contactId);
  const contacts = [...new Set(projects.map((p) => p.primaryContactId).filter((c) => c !== ''))];

  let invoices: ClientInvoice[] = [];
  try {
    const all = await reader.invoices.list();
    invoices = all
      .filter((i) => i.contactId !== null && contacts.includes(i.contactId))
      .filter(isIssued)
      .map(forClient);
  } catch {
    // A billing system being unreachable is not something to explain to a
    // homeowner in error-speak. Their contractor can still tell them.
    return shell(
      <PortalEmpty
        title="We can't load your invoices right now"
        body="This is on our side, not yours. Please try again shortly, or ask your contractor."
      />,
    );
  }

  if (invoices.length === 0) {
    return shell(
      <PortalEmpty
        title="No invoices yet"
        body="Nothing has been billed on this project so far. Invoices appear here as soon as they are issued."
      />,
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const totals = totalInvoices(
    invoices.map((i) => ({ ...i, contactId: null, contactName: '' })),
  );

  return shell(
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

      <p className="text-xs leading-relaxed text-navy-400">
        Invoices are issued by your contractor. If something here looks wrong, message them
        through the portal rather than paying it — it is quicker to fix before payment than
        after.
      </p>
    </>,
  );
}
