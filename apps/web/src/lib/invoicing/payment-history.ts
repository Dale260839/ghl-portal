export interface InvoiceFinancials {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number;
  paid: number;
  due: number;
  issueDate: string;
  dueDate: string;
  terms: string;
  business: { name: string; logo: string; phone: string; website: string; address: string };
  customer: string;
  items: { name: string; description: string; amount: number; quantity: number }[];
}

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const money = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 && Number.isSafeInteger(Math.round(v * 100)) ? Math.round(v * 100) / 100 : null;

/** Missing financial fields are an error, never a made-up zero payment. */
export function readInvoiceFinancials(body: unknown, expected: { id: string; locationId: string; contactId: string }): InvoiceFinancials {
  const outer = record(body);
  const row = outer.invoice ? record(outer.invoice) : outer;
  const contact = record(row.contactDetails);
  if (row._id !== expected.id || row.altId !== expected.locationId || row.altType !== 'location' || !expected.contactId || contact.id !== expected.contactId) {
    throw new Error('Invoice identity does not match this project and account');
  }
  const total = money(row.total), paid = money(row.amountPaid), due = money(row.amountDue);
  if (total === null || paid === null || due === null || text(row.currency) !== 'USD') {
    throw new Error('Invoice totals are incomplete or use an unsupported currency');
  }
  const status = text(row.status);
  if (!['draft','sent','paid','void','partially_paid','payment_processing'].includes(status)) throw new Error('Invoice status needs review');
  const summary = record(row.totalSummary), business = record(row.businessDetails), address = record(business.address);
  return {
    id: expected.id, number: String(row.invoiceNumber ?? expected.id), status, currency: 'USD',
    subtotal: money(summary.subTotal), tax: money(summary.tax), discount: money(summary.discount), total, paid, due,
    issueDate: text(row.issueDate).slice(0,10), dueDate: text(row.dueDate).slice(0,10), terms: text(row.termsNotes),
    business: {name: text(business.name), logo:text(business.logoUrl), phone:text(business.phoneNo), website:text(business.website),
      address: typeof business.address === 'string' ? business.address : [address.addressLine1,address.addressLine2,[address.city,address.state,address.postalCode].filter(Boolean).join(', ')].filter(Boolean).join('\n')},
    customer: text(contact.name),
    items: (Array.isArray(row.invoiceItems) ? row.invoiceItems : []).map(value=>{
      const item=record(value); const amount=money(item.amount), quantity=money(item.qty);
      if (amount === null || quantity === null) throw new Error('Invoice item needs review');
      return {name:text(item.name),description:text(item.description),amount,quantity};
    }),
  };
}

export interface ProjectInvoiceLink { id: string; projectId: string; externalId: string | null; sentVia: string | null; creationAttemptId?: string | null }
export interface PaymentHistory { checkedAt: string; entries: InvoiceFinancials[]; paid: number }

/** Only explicit project invoice IDs qualify. A shared contact is not a project join. */
export async function loadPaymentHistory(
  links: readonly ProjectInvoiceLink[], currentDraftId: string, projectId: string,
  read: (id: string) => Promise<InvoiceFinancials>, checkedAt = new Date().toISOString(),
): Promise<PaymentHistory> {
  if (links.length >= 200) throw new Error('Project invoice history needs pagination review');
  const currentExternalId = links.find(link=>link.id === currentDraftId && link.projectId === projectId)?.externalId;
  const selected = links.filter(link=>link.projectId === projectId && link.id !== currentDraftId && (!currentExternalId || link.externalId !== currentExternalId));
  const ids = new Set<string>();
  const entries: InvoiceFinancials[]=[];
  for (const link of selected) {
    if (!link.externalId) {
      if (link.creationAttemptId) throw new Error('An earlier invoice creation needs reconciliation');
      continue;
    }
    if (link.sentVia !== 'ghl') throw new Error('An invoice uses an unsupported payment source');
    if (ids.has(link.externalId)) continue;
    ids.add(link.externalId);
    const invoice=await read(link.externalId);
    if (invoice.id !== link.externalId) throw new Error('Wrong invoice returned');
    if (['draft','void'].includes(invoice.status)) continue;
    if (invoice.status === 'payment_processing') throw new Error('A project payment is still processing');
    entries.push(invoice);
  }
  return {checkedAt,entries,paid:entries.reduce((sum,row)=>sum+Math.round(row.paid*100),0)/100};
}

export const invoiceMoney = (value: number): string => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
export const escapeInvoiceHtml = (value: string): string => value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

/** Historical payments are informational, never a credit on this installment. */
export function historyNotes(history: PaymentHistory): string {
  const e=escapeInvoiceHtml;
  return `<h3>Project payment history</h3><p>Recorded in GoHighLevel as of ${e(history.checkedAt)}. Other issued invoices linked to this project.</p>`+
    (history.entries.length ? '<table><thead><tr><th>Invoice</th><th>Status</th><th>Total</th><th>Received</th><th>Outstanding</th></tr></thead><tbody>'+history.entries.map(row=>`<tr><td>${e(row.number)}</td><td>${e(row.status)}</td><td>${invoiceMoney(row.total)}</td><td>${invoiceMoney(row.paid)}</td><td>${invoiceMoney(row.due)}</td></tr>`).join('')+'</tbody></table>' : '<p>No other issued invoices are linked to this project.</p>')+
    `<p><strong>Received on other linked project invoices: ${invoiceMoney(history.paid)}</strong></p><p>These payments are not deducted again from this installment. The amount due above is for this invoice only. Payments not recorded in GoHighLevel or not linked to this project are not included. This is a snapshot; review payment history before sending.</p>`;
}
