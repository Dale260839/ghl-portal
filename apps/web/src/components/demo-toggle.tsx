import { toggleDemoData } from '@/lib/actions';

/**
 * The demo data switch, beside the view switcher in the header (D-017).
 *
 * Deliberately loud when it is on. A contractor who forgets this is flipped will
 * read fixtures as their own book of work, and the amber banner plus a lit pill
 * in the header is the difference between "sample content" and "our numbers are
 * wrong". When off it is a quiet outline, because that is the normal state.
 *
 * A plain form and a server action — no client JavaScript, so it works before
 * hydration and cannot get stuck mid-flip.
 *
 * Delete with `lib/demo-mode.ts` once the `hub_*` tables can carry a demo.
 */
export function DemoToggle({ on, returnTo }: { on: boolean; returnTo: string }) {
  return (
    <form action={toggleDemoData}>
      <input type="hidden" name="on" value={on ? 'false' : 'true'} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        aria-pressed={on}
        title={
          on
            ? 'Showing sample data. Click to go back to live BuildSuite projects.'
            : 'Showing live BuildSuite projects. Click to load sample data for a demo.'
        }
        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
          on
            ? 'border-amber-accent bg-amber-accent text-white'
            : 'border-navy-100 text-navy-600 hover:bg-navy-50'
        }`}
      >
        <span
          className={`inline-flex h-3.5 w-6 shrink-0 items-center rounded-full px-0.5 transition ${
            on ? 'justify-end bg-white/40' : 'justify-start bg-navy-200'
          }`}
        >
          <span className="block h-2.5 w-2.5 rounded-full bg-white" />
        </span>
        <span className="hidden sm:inline">Demo data</span>
      </button>
    </form>
  );
}
