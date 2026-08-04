'use client';

import { useActionState, useState } from 'react';
import { signIn } from '@/lib/actions';
import type { DemoAccount } from '@/lib/session';

export function LoginForm({ accounts }: { accounts: DemoAccount[] }) {
  const [selected, setSelected] = useState(accounts[0]?.email ?? '');
  const [state, formAction, pending] = useActionState(signIn, undefined);

  return (
    <form action={formAction} className="mt-7">
      <fieldset className="space-y-2.5">
        <legend className="sr-only">Choose an experience</legend>
        {accounts.map((account) => {
          const active = selected === account.email;
          return (
            <label
              key={account.email}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 transition ${
                active
                  ? 'border-navy-600 bg-navy-50 ring-1 ring-navy-600'
                  : 'border-navy-100 hover:border-navy-200 hover:bg-navy-50/50'
              }`}
            >
              <input
                type="radio"
                name="email"
                value={account.email}
                checked={active}
                onChange={() => setSelected(account.email)}
                className="mt-1 h-4 w-4 shrink-0 accent-navy-600"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-navy-900">{account.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-navy-400">
                  {account.description}
                </span>
                <span className="mt-1.5 block truncate text-xs text-navy-400">
                  {account.name} · {account.email}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {state?.error !== undefined && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-5 w-full rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600 disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
