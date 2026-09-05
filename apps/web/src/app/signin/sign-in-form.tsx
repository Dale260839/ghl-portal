'use client';

import { useActionState } from 'react';
import { requestSignIn } from '@/lib/actions';

/**
 * The homeowner's front door.
 *
 * Two fields, because C-2 says both are needed to locate a project and neither
 * alone gets anyone anywhere. The result panel is deliberately the same for
 * every outcome the action can return, so nothing on this screen confirms
 * whether an account exists.
 */
export function SignInForm() {
  const [state, formAction, pending] = useActionState(requestSignIn, undefined);

  if (state?.message !== undefined) {
    return (
      <div className="mt-7 rounded-lg border border-navy-100 bg-navy-50/60 p-5" role="status">
        <p className="text-sm leading-relaxed text-navy-900">{state.message}</p>
        <p className="mt-3 text-xs leading-relaxed text-navy-400">
          The link opens your project directly. You will not need a password.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-7 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-navy-900">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="mt-1.5 w-full rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy-600"
        />
      </div>

      <div>
        <label htmlFor="projectCode" className="block text-sm font-medium text-navy-900">
          Project code
        </label>
        <input
          id="projectCode"
          name="projectCode"
          type="text"
          required
          placeholder="BSA-044"
          className="mt-1.5 w-full rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy-600"
        />
        <p className="mt-1.5 text-xs text-navy-400">
          Your contractor gives you this when your project starts.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600 disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>

      <p className="text-xs leading-relaxed text-navy-400">
        We email you a link rather than asking for a password. It works once and expires in 15
        minutes.
      </p>
    </form>
  );
}
