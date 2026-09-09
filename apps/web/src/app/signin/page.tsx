import { SignInForm } from './sign-in-form';

/**
 * Homeowner sign-in (§9.2, C-2).
 *
 * The front door that turns email + project code into a session. It used to
 * turn them into an emailed link instead; Chris replaced that on 2026-09-10
 * with the code itself as the password, sent by a BuildSuite automation when
 * the contract is signed. See `lib/auth/client-credentials.ts`.
 *
 * A separate route from `/` on purpose — `/` is the contractor and demo entry,
 * this is the one a homeowner is sent to, and the two should never share a
 * form.
 */

export const metadata = {
  title: 'Sign in to your Project Hub',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Set by the retired `/auth/verify` route, so an old emailed link lands here
  // with an explanation rather than on a 404.
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Sign in to your Project Hub
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-navy-500">
          See your project’s progress, schedule, documents and updates in one place.
        </p>
      </div>

      {error !== undefined && error !== '' && (
        <p
          className="mt-5 rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3 text-sm leading-relaxed text-navy-900"
          role="alert"
        >
          {error}
        </p>
      )}

      <SignInForm />

      <p className="mt-8 border-t border-navy-100 pt-5 text-xs leading-relaxed text-navy-400">
        Trouble signing in? Contact your contractor directly. They can confirm your project code and
        the email address on your project.
      </p>
    </main>
  );
}
