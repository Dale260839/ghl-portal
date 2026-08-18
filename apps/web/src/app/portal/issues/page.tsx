import { PortalEmpty } from '@/components/ui';

/**
 * Issues & Requests — Phase B/C.
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Issues &amp; Requests</h1>
        <p className="mt-1 text-sm text-navy-400">Report concerns, defects, or project requests.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="Reporting from the portal is being connected. Anything you have already raised is with your project manager."
        tiles={[
          { label: 'Report', hint: 'Raise a concern' },
          { label: 'Track', hint: 'See the status' },
          { label: 'Confirm', hint: 'Close it when resolved' },
        ]}
      />
    </div>
  );
}
