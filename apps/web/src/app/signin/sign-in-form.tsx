'use client';

import { useActionState } from 'react';
import { signInWithCode } from '@/lib/actions';

/**
 * The homeowner's front door.
 *
 * ---------------------------------------------------------------------------
 * TWO FIELDS, AND NOW THEY ARE CREDENTIALS
 *
 * This screen used to email a sign-in link: the code merely located a record
 * and the emailed token was the credential. Chris changed that on 2026-09-10 —
 * signing the contract fires a BuildSuite automation that sends the homeowner
 * their project code, and the code is the password. No inbox in the middle, no
 * link to expire, nothing for a contractor to remember to send.
 *
 * The failure copy never says WHICH half was wrong. Saying "no account with
 * that email" would turn this form into a way to find out whose contracts have
 * been signed, and saying "wrong code" would confirm an address on its own.
 * ---------------------------------------------------------------------------
 */
export function SignInForm() {
  const [state, formAction, pending] = useActionState(signInWithCode, undefined);

  return (
    <form action={formAction} className="mt-7 space-y-4">
      {state?.message !== undefined && state.message !== '' && (
        <div
          className="rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3"
          role="alert"
        >
          <p className="text-sm leading-relaxed text-navy-900">{state.message}</p>
        </div>
      )}

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
        <p className="mt-1.5 text-xs text-navy-400">The address on your contract.</p>
      </div>

      <div>
        <label htmlFor="projectCode" className="block text-sm font-medium text-navy-900">
          Project code
        </label>
        <input
          id="projectCode"
          name="projectCode"
          type="text"
          // It is a password in everything but name, so the browser is told
          // that: no autocorrect, no autocapitalise fighting the uppercase
          // format, and no shoulder-surfing on a job site.
          autoComplete="current-password"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          required
          placeholder="BSA-044"
          className="mt-1.5 w-full rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm tracking-wide text-navy-900 uppercase placeholder:text-navy-300 placeholder:normal-case focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy-600"
        />
        <p className="mt-1.5 text-xs text-navy-400">
          Emailed to you when your contract was signed.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-xs leading-relaxed text-navy-400">
        Your project code works as your password. Do not have it? Ask your contractor — it is in
        the email sent when your contract was signed.
      </p>
    </form>
  );
}
