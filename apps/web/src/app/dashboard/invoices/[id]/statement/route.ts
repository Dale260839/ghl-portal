import { getSession } from '@/lib/session';
import { actionTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubInvoiceDrafts } from '@/lib/hub-db/invoice-drafts';
import { getInvoices } from '@/lib/ghl/invoices';
import { loadPaymentHistory } from '@/lib/invoicing/payment-history';
import { invoiceStatement } from '@/lib/invoicing/statement';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, {params}: {params:Promise<{id:string}>}) {
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  const session=await getSession();
  if (!session || session.role !== 'contractor') return new Response('Contractor sign-in required',{status:403,headers});
  try {
    const scope=await actionTenantScope(session);
    const projectId=new URL(request.url).searchParams.get('projectId') ?? '';
    if (!projectId) return new Response('Project required',{status:400,headers});
    const project=await (await currentDataSource(scope)).getProject(scope,projectId);
    const hub=getHubInvoiceDrafts();
    if (!project || !hub.available) return new Response('Invoice not available',{status:404,headers});
    const links=await hub.drafts.listForProject(scope,projectId);
    const {id}=await params;
    const draft=links.find(row=>row.id===id && row.projectId===projectId);
    if (!draft?.externalId || draft.sentVia !== 'ghl') return new Response('Linked GHL invoice required',{status:404,headers});
    const source=await getInvoices(scope.locationId);
    if (!source.available) throw new Error('GHL unavailable');
    const read=(externalId:string)=>source.invoices.financials(externalId,project.primaryContactId);
    const invoice=await read(draft.externalId);
    const history=await loadPaymentHistory(links,draft.id,projectId,read);
    return new Response(invoiceStatement(invoice,history,project.projectCode ?? ''),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; img-src https:; style-src 'unsafe-inline'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"}});
  } catch {
    return new Response('Invoice totals or project payment history could not be verified. Open GoHighLevel and review the linked invoices; no records were changed.',{status:502,headers});
  }
}
