import { PortalEmpty } from '@/components/ui';

/**
 * Change Orders — Phase B/C.
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Change Orders</h1>
        <p className="mt-1 text-sm text-navy-400">Review and approve modifications to the project scope.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="Change order review is being connected. Your project manager will keep sending these directly until it is live."
        tiles={[
          { label: 'Cost Impact', hint: 'What it adds' },
          { label: 'Schedule Impact', hint: 'Days added' },
          { label: 'Approve or Ask', hint: 'Decide, or ask first' },
        ]}
      />
    </div>
  );
}
