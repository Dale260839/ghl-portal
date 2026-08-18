import { PortalEmpty } from '@/components/ui';

/**
 * Completion & Warranty — Phase B/C.
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Completion &amp; Warranty</h1>
        <p className="mt-1 text-sm text-navy-400">Project closeout, punch list, and warranty information.</p>
      </div>
      <PortalEmpty
        title="Coming shortly"
        body="This section becomes active as your project nears completion."
        tiles={[
          { label: 'Punch List', hint: 'Track final touch-ups' },
          { label: 'Warranties', hint: 'Access coverage details' },
          { label: 'Service Requests', hint: 'Submit warranty claims' },
        ]}
      />
    </div>
  );
}
