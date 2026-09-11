import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { resolveContractorProfile } from '@/lib/buildsuite/contractor-identity';
import { getHubInvoiceTemplates } from '@/lib/hub-db/invoice-templates';
import {
  dueDaysFor,
  previewLetterhead,
  termsFor,
  TEMPLATE_LIMITS,
  type InvoiceTemplate,
} from '@/lib/invoicing/template';
import { InvoicePreview } from '@/components/invoice-preview';
import { InvoiceTemplateForm } from '@/components/invoice-template-form';
import { NotLinkedToContractor } from '@/components/not-linked';
import { Card, CardHeader } from '@/components/ui';

/**
 * Invoice template — the look of every invoice this account sends.
 *
 * Chris, huddle 2026-09-10: "reusable invoice templates with company logos that
 * contractors can customize per account."
 *
 * Until now the letterhead came only from the contractor's BuildSuite record,
 * which the Hub cannot write, so a contractor had no way to change their own
 * invoice logo from here. Each field below overrides BuildSuite when filled in
 * and falls back to it when blank.
 *
 * The preview is built by the SAME merge the invoice uses (`previewLetterhead`
 * over `mergeLetterhead`), so it cannot show a logo or terms that GoHighLevel
 * would not receive. It shows the SAVED template — save, and it updates.
 */
export default async function InvoiceTemplatePage() {
  const scope = await requireTenantScope();
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="The invoice template" />;
  }

  const profile = await resolveContractorProfile(scope);

  let template: InvoiceTemplate | null = null;
  let problem: string | null = null;
  const hub = getHubInvoiceTemplates();
  if (!hub.available) {
    problem = `The Hub database is not connected (missing ${hub.missing.join(', ')}). Invoices use your BuildSuite details until it is.`;
  } else {
    try {
      template = await hub.templates.getForContractor(scope);
    } catch {
      problem = 'Your template could not be read just now. Invoices use your BuildSuite details until it can.';
    }
  }

  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + dueDaysFor(template));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/invoices" className="text-xs font-medium text-navy-500 hover:text-navy-800">
          ← Invoices
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-navy-900">Invoice template</h1>
        <p className="mt-1 max-w-2xl text-sm text-navy-400">
          Your logo, business details and payment terms, on every invoice this account sends. The
          stages and amounts are never part of a template — they come from each job&apos;s signed
          contract.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="px-5 py-5">
          <InvoiceTemplateForm
            initial={template}
            fallback={profile}
            canSave={problem === null}
            problem={problem}
            limits={TEMPLATE_LIMITS}
            defaultDueInDays={dueDaysFor(null)}
          />
        </Card>

        <div className="space-y-2">
          <Card>
            <CardHeader title="How your invoices will look" />
            <div className="px-5 py-5">
              <InvoicePreview
                business={previewLetterhead(profile, template)}
                reference="Project code · Invoice 1"
                clientName="Your client"
                clientEmail={null}
                title="Example stage"
                terms={termsFor(
                  'The terms for this stage, exactly as the signed contract states them.',
                  template,
                )}
                amount={1000}
                issueDate={today.toISOString().slice(0, 10)}
                dueDate={due.toISOString().slice(0, 10)}
              />
            </div>
          </Card>
          <p className="text-xs text-navy-400">
            An example. Real invoices carry the job&apos;s project code, client and stage.
          </p>
        </div>
      </div>
    </div>
  );
}
