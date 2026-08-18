import { PortalEmpty } from '@/components/ui';

/**
 * Designs & Selections — Phase B/C.
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Designs &amp; Selections</h1>
        <p className="mt-1 text-sm text-navy-400">Review and approve materials, finishes, and layouts.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="Material selections and approvals are being connected to your project now."
        tiles={[
          { label: 'Material Selections', hint: 'Approve finishes and fittings' },
          { label: 'Design Layouts', hint: 'Review floorplans' },
          { label: 'Upgrade Costs', hint: 'See the price impact before you decide' },
        ]}
      />
    </div>
  );
}
