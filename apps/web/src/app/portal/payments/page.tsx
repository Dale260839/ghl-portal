import { PortalEmpty } from '@/components/ui';

/**
 * Payments & Invoices — Phase B/C.
 *
 * A designed placeholder rather than a missing route. A client who clicks a nav
 * item and gets a 404 concludes the product is broken; one who reads what's
 * coming concludes it's being built. The demo does the same thing on its own
 * Completion & Warranty screen.
 */
export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Payments &amp; Invoices</h1>
        <p className="mt-1 text-sm text-navy-400">Manage your project payments and billing history.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="Invoices and payment are handled in your secure account today. In-portal payment is under review."
        tiles={[
          { label: 'Invoice History', hint: 'Everything billed' },
          { label: 'Outstanding', hint: 'What is due' },
          { label: 'Pay', hint: 'Securely, when live' },
        ]}
      />
    </div>
  );
}
