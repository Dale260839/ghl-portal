import { SignInForm } from './sign-in-form';

/**
 * Homeowner sign-in (§9.2, C-2).
 *
 * The page D3 §6 asks for and the Hub has been missing: the front door that
 * turns email + project code into an emailed link. It is a separate route from
 * `/` on purpose — `/` is the contractor and demo entry, this is the one a
 * homeowner is sent to, and the two should never share a form.
 */

export const metadata = {
  title: 'Sign in to your Project Hub',
};

export default function SignInPage() {
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

      <SignInForm />

      <p className="mt-8 border-t border-navy-100 pt-5 text-xs leading-relaxed text-navy-400">
        Trouble signing in? Contact your contractor directly. They can confirm your project code and
        the email address on your project.
      </p>
    </main>
  );
}
