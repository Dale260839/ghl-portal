import { redirect } from 'next/navigation';
import { DEMO_ACCOUNTS, getSession, homeFor } from '@/lib/session';
import { LoginForm } from './login-form';

export default async function SignInPage() {
  const session = await getSession();
  if (session !== null) {
    redirect(homeFor(session.role));
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Left — the pitch. One record, three views. */}
      <section className="relative hidden flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div>
          <div className="text-lg font-semibold tracking-tight">
            BuildSuite<span className="align-super text-[0.6em]">™</span>
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

        <p className="text-xs text-navy-400">
          Internal costs, markup, and margin are stripped at the data layer — not hidden in the UI.
        </p>
      </section>

      {/* Right — sign in. */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <div className="text-lg font-semibold tracking-tight text-navy-900">
              BuildSuite<span className="align-super text-[0.6em]">™</span>
            </div>
            <div className="mt-1 mb-8 text-sm text-navy-400">Alliance Pro Services</div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-navy-900">Sign in</h2>
          <p className="mt-1.5 text-sm text-navy-400">
            Choose an experience below to sign in as that user.
          </p>

          <LoginForm accounts={DEMO_ACCOUNTS} />

          <p className="mt-8 border-t border-navy-100 pt-5 text-xs leading-relaxed text-navy-400">
            <strong className="font-semibold text-navy-600">Demo sign-in.</strong> Production auth
            is GoHighLevel portal login. Approvals, payments, contracts, documents, and private
            messages will require it — an email and project ID will never be enough on their own.
          </p>
        </div>
      </section>
    </main>
  );
}
