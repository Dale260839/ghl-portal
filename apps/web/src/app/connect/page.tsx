import { isGhlLocationId } from '@/lib/ghl/config';
import { oauthEnabled } from '@/lib/ghl/oauth-config';

/**
 * Onboarding: the first screen a brand-new contractor sees.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT BEHIND SIGN-IN
 *
 * It cannot be. A contractor whose sub-account has never been connected cannot
 * sign in at all: the Hub proves a sub-account by calling GoHighLevel with a
 * credential for it, and the credential is the very thing that is missing. That
 * is the dead end their menu link hit on 2026-09-23 — *"That link doesn't match
 * a sub-account we have access to"* — with nothing to do about it.
 *
 * So this page stands in front of the door rather than behind it, and the
 * authority for connecting is **GoHighLevel's own approval screen**, which only
 * somebody with access to that sub-account can complete. That is a stronger
 * gate than a session we cannot issue anyway.
 *
 * WHICH ROUTE IT SENDS PEOPLE DOWN
 *
 * The App Marketplace **inside their own account**, first and in words. The
 * OAuth link is second, and labelled as the other option, because it ends on
 * `marketplace.gohighlevel.com` — and a contractor in a white-labelled agency
 * signs in at the agency's domain and has never had a HighLevel login. Sending
 * them to one is a dead end dressed as a button. The in-account route uses the
 * session they already have.
 *
 * It is laid out as the sign-in page's twin, because that is what it is: the
 * other way into the product. A contractor's first impression should not be a
 * utility page that looks like it belongs to a different application.
 *
 * WHAT IT MAY SHOW
 *
 * Nothing about the project, the contractor or the client — no read happens
 * here. Only the sub-account id already in the URL, which the visitor brought
 * with them. The page is a door, and a door does not know who is behind it.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

const STEPS: [string, string][] = [
  [
    'Open App Marketplace',
    'In the left-hand menu of your own account. You are already signed in there, which is why this is the way to do it.',
  ],
  [
    'Find Project Hub and install it',
    'You will be asked to allow it to work with your contacts, conversations and invoices — that is how it sends invoices and appointment emails on your behalf.',
  ],
  [
    'That is the whole setup',
    'No keys, no settings, nothing to install on your computer. It stays connected from then on.',
  ],
]

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ locationId?: string }>;
}) {
  const { locationId } = await searchParams;
  const location = isGhlLocationId(locationId) ? locationId.trim() : null;
  const live = oauthEnabled();
  const startHref =
    location === null ? '/api/connect/start' : `/api/connect/start?locationId=${location}`;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left — the same pitch the sign-in page makes. */}
      <section className="relative hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div>
          <div className="text-lg font-semibold tracking-tight">
            BuildSuite<span className="align-super text-[0.6em]">™</span> Project Hub
          </div>
          <div className="mt-1 text-sm text-navy-200">Setting up your account</div>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            One shared project record.
            <br />
            Three controlled experiences.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">
            Estimating and proposals stay in BuildSuite. At signing, the project hands off once —
            and from there you, your field crew, and your client each see exactly what you should,
            and nothing more.
          </p>

          <dl className="mt-9 space-y-4">
            {[
              ['Contractor Dashboard', 'Creates and controls every project, stage, and approval.'],
              ['Field Interface', 'Submits updates, tasks, and photos. Never publishes.'],
              ['Client Portal', 'Sees approved progress only — costs and internal notes never cross.'],
            ].map(([title, body]) => (
              <div key={title} className="flex gap-3.5">
                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-accent" />
                <div>
                  <dt className="text-sm font-medium text-white">{title}</dt>
                  <dd className="mt-0.5 text-sm text-navy-200">{body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-navy-300">
          Internal costs, markup, and margin are stripped at the data layer — not hidden in the UI.
        </p>
      </section>

      {/* Right — the one thing to do. */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-navy-900">
              BuildSuite<span className="align-super text-[0.6em]">™</span> Project Hub
            </div>
            <div className="mt-1 mb-8 text-sm text-navy-400">Setting up your account</div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-navy-900">
            Connect your account
          </h2>
          <p className="mt-1.5 text-sm text-navy-400">
            One approval and Project Hub is ready. Three steps, about a minute.
          </p>

          <ol className="mt-7 space-y-5">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-medium text-navy-900">{title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-navy-500">{body}</p>
                </div>
              </li>
            ))}
          </ol>

          {live ? (
            <>
              <p className="mt-8 rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3.5 text-xs leading-relaxed text-navy-600">
                <strong className="font-semibold text-navy-900">Do it from inside your account.</strong>{' '}
                The App Marketplace in your own left-hand menu uses the login you already have. The
                button below goes to GoHighLevel&rsquo;s own site, which asks for a separate HighLevel
                login that most people do not have.
              </p>
              <a
                href={startHref}
                className="mt-4 flex w-full items-center justify-center rounded-lg border border-navy-200 px-5 py-2.5 text-sm font-semibold text-navy-900 transition hover:bg-navy-50"
              >
                Connect on GoHighLevel instead
              </a>
            </>
          ) : (
            // The switch is off on this deployment. Offering "Connect" would
            // send somebody round a loop that cannot finish.
            <p
              className="mt-8 rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-navy-900"
              role="alert"
            >
              Connecting is not switched on for this site yet. Ask whoever set up Project Hub for you.
            </p>
          )}

          <div className="mt-8 rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3.5">
            <p className="text-sm font-medium text-navy-900">Already connected?</p>
            <p className="mt-1 text-xs leading-relaxed text-navy-500">
              Open Project Hub from the menu in your account — there is no password to enter here.
              Field crew and homeowners sign in on the{' '}
              <a href="/" className="font-medium text-navy-900 underline underline-offset-2">
                main sign-in page
              </a>
              .
            </p>
          </div>

          {location !== null && (
            <p className="mt-6 border-t border-navy-100 pt-5 font-mono text-xs text-navy-400">
              {location}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
