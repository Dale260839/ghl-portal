import { PortalEmpty } from '@/components/ui';

/**
 * Budget & Pricing — Phase B/C.
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Budget &amp; Pricing</h1>
        <p className="mt-1 text-sm text-navy-400">Track project costs, allowances, and payments.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="A detailed per-category breakdown is being added to the summary already on your dashboard."
        tiles={[
          { label: 'By Category', hint: 'Original, changes, current' },
          { label: 'Allowances', hint: 'What is set aside' },
          { label: 'Change Impact', hint: 'What each change added' },
        ]}
      />
    </div>
  );
}
