import { redirect } from 'next/navigation';
import { DEMO_ACCOUNTS, getSession, homeFor } from '@/lib/session';
import { demoSignInEnabled } from '@/lib/demo-accounts';
import { LoginForm, type DemoChoice } from './login-form';

/**
 * The ONE sign-in route (John, 2026-09-15).
 *
 * Everyone lands here. Field crew and homeowners sign in with the form; the
 * server works out which they are. Contractors arrive already signed in from
 * the BuildSuite menu in GoHighLevel (`/auth/ghl` → `/api/auth/ghl`), and a
 * link that cannot be verified comes back here with `?error=`, which is shown
 * rather than silently dropped. `/signin` — the old homeowner page, and where
 * earlier emails point — redirects here.
 *
 * Anyone already signed in goes straight to their home, so opening the Hub
 * again from BuildSuite, or from a bookmark, lands on the work.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const session = await getSession();
  if (session !== null) {
    redirect(homeFor(session.role));
  }

  const raw = (await searchParams).error;
  const error = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';

  // Empty on every deployment that has not set the flag, so no demo identity
  // reaches the page or the browser.
  const demo: DemoChoice[] = demoSignInEnabled()
    ? DEMO_ACCOUNTS.map((a) => ({ email: a.email, label: `${a.name} · ${a.role}` }))
    : [];

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left — the pitch. One record, three views. */}
      <section className="relative hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div>
          <div className="text-lg font-semibold tracking-tight">
            BuildSuite<span className="align-super text-[0.6em]">™</span> Project Hub
          </div>
          <div className="mt-1 text-sm text-navy-200">Alliance Pro Services</div>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">
            One shared project record.
            <br />
            Three controlled experiences.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-navy-200">
            Estimating and proposals stay in BuildSuite. At signing, the project hands off once —
            and from there the contractor, the field crew, and the client each see exactly what
            they should, and nothing more.
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

      {/* Right — sign in. */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-navy-900">
              BuildSuite<span className="align-super text-[0.6em]">™</span> Project Hub
            </div>
            <div className="mt-1 mb-8 text-sm text-navy-400">Alliance Pro Services</div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-navy-900">Sign in</h2>
          <p className="mt-1.5 text-sm text-navy-400">
            Homeowners and field crew — use the email your contractor has on file.
          </p>

          {error !== '' && (
            <p
              className="mt-5 rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-navy-900"
              role="alert"
            >
              {error}
            </p>
          )}

          <LoginForm demo={demo} />

          <div className="mt-8 rounded-lg border border-navy-100 bg-navy-50/60 px-4 py-3.5">
            <p className="text-sm font-medium text-navy-900">Contractor?</p>
            <p className="mt-1 text-xs leading-relaxed text-navy-500">
              Open Project Hub from the BuildSuite menu in GoHighLevel. You are signed in
              automatically — there is no password to enter here.
            </p>
          </div>

          <p className="mt-6 border-t border-navy-100 pt-5 text-xs leading-relaxed text-navy-400">
            Forgot your password, or can’t find your project code? Contact your contractor. They can
            send field crew a password reset from the project’s People page, and confirm a
            homeowner’s project code and email.
          </p>
        </div>
      </section>
    </main>
  );
}
