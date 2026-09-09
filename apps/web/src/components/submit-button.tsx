'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/**
 * A submit button that knows its form is in flight.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every form on the contractor screens was a plain `<button type="submit">`.
 * A server action takes a round trip, the button stayed live throughout, and a
 * second click fired the action again.
 *
 * For most forms that is a duplicate row. For two of them it is worse:
 *
 *   · "Create in GoHighLevel" would create a SECOND real invoice, and a
 *     homeowner can be asked to pay both. There is a unique index and an
 *     `external_id is null` filter behind it, but a guard that has to catch a
 *     race is worse than a click that cannot happen twice.
 *   · "Approve change order" would record a client's answer twice.
 *
 * `useFormStatus` reports the enclosing form's state, so this has to be a
 * client component and has to live INSIDE the form — that is the whole
 * mechanism, not an implementation detail.
 * ---------------------------------------------------------------------------
 */

export function SubmitButton({
  children,
  pendingLabel,
  name,
  value,
  tone = 'primary',
  className,
  disabled,
}: {
  children: ReactNode;
  /** Shown while in flight. Defaults to the label plus an ellipsis. */
  pendingLabel?: ReactNode;
  /** For forms with two submits, where the value carries the answer. */
  name?: string;
  value?: string;
  tone?: 'primary' | 'secondary' | 'danger';
  className?: string;
  /** A reason of the caller's own, ANDed with the pending state. */
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  const base =
    'rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50';
  const tones = {
    primary: 'bg-navy-900 text-white hover:bg-navy-700',
    secondary: 'border border-navy-200 text-navy-700 hover:bg-navy-50',
    danger: 'text-red-700 hover:underline',
  } as const;

  return (
    <button
      type="submit"
      name={name}
      value={value}
      // Disabled while ANY submit of this form is in flight, including the
      // other button on a two-answer form — approving and declining the same
      // change order in quick succession must not both land.
      disabled={pending || disabled === true}
      aria-busy={pending}
      className={className ?? `${base} ${tones[tone]}`}
    >
      {pending ? (pendingLabel ?? <>{children}…</>) : children}
    </button>
  );
}
