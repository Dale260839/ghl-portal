'use client';

import Link from 'next/link';

/**
 * What a person sees when a screen or a save fails.
 *
 * Next's default is a blank page reading "Application error: a server-side
 * exception has occurred" with a digest. Chris hit exactly that on 11 Sep when
 * a selection could not be saved: the row was refused by the database and the
 * whole workspace went white. Nothing was lost, but the page said nothing
 * useful and offered nothing to click.
 *
 * Production omits the error message on purpose (it may name tables or keys),
 * so this cannot say precisely what failed. It can say that nothing is lost,
 * offer to try again, and offer the way back. The digest stays visible so the
 * server log can be matched to what the person saw.
 */
export function FriendlyError({
  error,
  reset,
  backHref,
  backLabel,
  what,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
  what: string;
}) {
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-xl border border-navy-100 bg-white px-6 py-8 text-center shadow-sm">
      <p className="text-base font-semibold text-navy-900">That did not go through.</p>
      <p className="mt-2 text-sm leading-relaxed text-navy-600">
        {what} could not be loaded or saved just now. Nothing you had already saved is lost. If you
        were adding something, it was not added; try once more, and if it fails again the Hub
        database refused the write and the team needs to look at it.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
        >
          Try again
        </button>
        <Link
          href={backHref}
          className="rounded-lg border border-navy-200 px-4 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50"
        >
          {backLabel}
        </Link>
      </div>
      {error.digest !== undefined && (
        <p className="mt-5 font-mono text-[11px] text-navy-400">Reference {error.digest}</p>
      )}
    </div>
  );
}
