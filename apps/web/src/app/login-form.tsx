'use client';

import { useActionState, useRef, useState } from 'react';
import { signIn } from '@/lib/actions';
import { SubmitButton } from '@/components/submit-button';

/**
 * The ONE sign-in form (John, 2026-09-15).
 *
 * ---------------------------------------------------------------------------
 * TWO FIELDS FOR EVERYONE WHO TYPES CREDENTIALS
 *
 * Field crew type the password they set from their invitation. Homeowners type
 * the project code the BuildSuite automation emailed them when they signed.
 * Nobody picks which they are: the server reads the shape of the second field
 * and routes it (`lib/auth/unified-sign-in.ts`). Contractors never see this
 * form — they arrive signed in from the BuildSuite menu in GoHighLevel.
 *
 * This replaces three things: demo-identity radio buttons that signed anyone
 * in with no password, a separate "account" email/password pair beside them,
 * and a separate homeowner page at `/signin`. One door, one set of rules.
 *
 * The secret field is a password field with a reveal toggle, not a text field:
 * it IS a password for the crew, and a homeowner reading `BSA-053` off a phone
 * can show it to check what they typed.
 * ---------------------------------------------------------------------------
 */

const INPUT =
  'mt-1.5 w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 placeholder:text-navy-300 focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy-600';

export interface DemoChoice {
  email: string;
  label: string;
}

export function LoginForm({ demo }: { demo: DemoChoice[] }) {
  const [state, formAction] = useActionState(signIn, undefined);
  const [reveal, setReveal] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  return (
    <form action={formAction} className="mt-7 space-y-4">
      {state?.error !== undefined && (
        <p
          className="rounded-lg border border-red-600/20 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800"
          role="alert"
        >
          {state.error}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-navy-900">
          Email address
        </label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          // A failed attempt keeps the email; the secret is never sent back.
          defaultValue={state?.email ?? ''}
          placeholder="you@example.com"
          className={INPUT}
        />
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="secret" className="block text-sm font-medium text-navy-900">
            Password or project code
          </label>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-controls="secret"
            aria-pressed={reveal}
            className="text-xs font-medium text-navy-500 underline-offset-2 hover:text-navy-800 hover:underline"
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>
        <input
          ref={secretRef}
          id="secret"
          name="secret"
          type={reveal ? 'text' : 'password'}
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={INPUT}
          aria-describedby="secret-help"
        />
        <p id="secret-help" className="mt-1.5 text-xs leading-relaxed text-navy-400">
          Homeowners: the project code from your signed contract, like BSA-053. Field crew: the
          password you set from your invitation.
        </p>
      </div>

      <SubmitButton
        pendingLabel="Signing in…"
        className="w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Sign in
      </SubmitButton>

      {/* Development only. The server passes an empty list unless
          ENABLE_DEMO_SIGNIN=true, so on a deployment this renders nothing and
          ships no identities. Filling the fields rather than signing in keeps
          it on the same path as everyone else. */}
      {demo.length > 0 && (
        <div className="rounded-lg border border-dashed border-amber-600/40 bg-amber-50/60 px-4 py-3">
          <p className="text-xs font-semibold text-navy-800">Development: demo identities are on</p>
          <p className="mt-0.5 text-xs text-navy-500">
            They have no password. Never set ENABLE_DEMO_SIGNIN on a shared deployment.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {demo.map((d) => (
              <button
                key={d.email}
                type="button"
                onClick={() => {
                  if (emailRef.current !== null) emailRef.current.value = d.email;
                  if (secretRef.current !== null) secretRef.current.value = 'demo';
                }}
                className="rounded-md border border-navy-200 bg-white px-2 py-1 text-xs text-navy-700 hover:bg-navy-50"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}
