/**
 * "Connect Project Hub to your GoHighLevel account."
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * GoHighLevel issues a token for a sub-account only when that sub-account has
 * installed the app. There is no configuration that avoids it: consent is the
 * rule, which is why the agency-wide install was refused the scopes the Hub
 * needs. So somebody has to click once, per contractor.
 *
 * This decides WHO clicks and WHEN. Before it, the answer was "an
 * administrator, during onboarding, by creating a Private Integration token,
 * copying it into the deployment and redeploying" — four steps handling a live
 * credential, done by someone who is not the person who needs it. After it, the
 * answer is "whoever opens the Hub, at the moment they first need it", and no
 * key is ever seen by anyone.
 *
 * WHEN IT SAYS NOTHING
 *
 * When the app is switched off on this deployment, and when the sub-account is
 * already connected. A banner that appears where there is nothing to do teaches
 * people to ignore banners.
 * ---------------------------------------------------------------------------
 */
export function ConnectBanner({
  connected,
  hasFallback,
}: {
  /** `null` when the Marketplace app is not switched on here — say nothing. */
  connected: boolean | null;
  /** Whether a Private Integration token still covers this sub-account. */
  hasFallback: boolean;
}) {
  if (connected !== false) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-amber-600/20 bg-amber-soft px-4 py-1.5 text-center text-xs text-amber-700">
      {hasFallback ? (
        // Working today on a token somebody pasted in. Worth moving, not worth
        // alarming anyone about.
        <span>
          <strong className="font-semibold">Not connected yet.</strong> Connect this account to
          send invoices and emails without a shared API key.
        </span>
      ) : (
        // Nothing works for them until this is done, and saying so plainly is
        // kinder than letting them find out one failed invoice at a time.
        <span>
          <strong className="font-semibold">Connect to finish setup.</strong> Until this account is
          connected, invoices and emails cannot be sent.
        </span>
      )}
      <a
        href="/api/connect/start"
        className="rounded bg-amber-700 px-2 py-0.5 font-semibold text-white hover:bg-amber-800"
      >
        Connect
      </a>
    </div>
  );
}
