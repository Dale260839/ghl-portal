'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  ARM_TIMEOUT_MS,
  clickSubmits,
  confirmHint,
  confirmLabel,
  nextPhase,
  type ConfirmPhase,
} from '@/lib/confirm-state';

/**
 * A submit button that asks once before doing something to somebody.
 *
 * Wraps the same `useFormStatus` mechanism as `SubmitButton` — it must live
 * inside the form, that is how it knows the form is in flight — and adds a
 * deliberate second act in front of the submit.
 *
 * **It stays a real submit button.** The first click is prevented, not
 * intercepted by script that then submits for you; with the arming disabled
 * this degrades to an ordinary submit rather than a button that does nothing.
 *
 * See `lib/confirm-state.ts` for why this is not a modal.
 */
export function ConfirmSubmit({
  label,
  confirmLabel: armedLabel,
  reversible,
  name,
  value,
  className = '',
}: {
  label: string;
  /** Names the consequence — "Revoke access", not "Yes". */
  confirmLabel: string;
  reversible: boolean;
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  const [phase, setPhase] = useState<ConfirmPhase>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // An armed button that stays armed is the original problem with a step in
  // front of it: the next stray click fires it.
  useEffect(() => {
    if (phase !== 'armed') return;
    timer.current = setTimeout(() => setPhase('idle'), ARM_TIMEOUT_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [phase]);

  const copy = { idle: label, armed: armedLabel, reversible };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        {...(name === undefined ? {} : { name })}
        {...(value === undefined ? {} : { value })}
        onClick={(event) => {
          // The click that arms must NOT submit. A confirmation that submits on
          // the first click looks safe and is not.
          if (!clickSubmits(phase)) {
            event.preventDefault();
            setPhase(nextPhase(phase));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setPhase('idle');
        }}
        className={`press rounded-lg px-3 py-1.5 text-xs font-medium transition ${
          phase === 'armed'
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'border border-navy-200 bg-white text-navy-600 hover:border-navy-400/40 hover:bg-navy-50'
        } ${pending ? 'opacity-70' : ''} ${className}`}
      >
        {pending ? `${armedLabel}…` : confirmLabel(phase, copy)}
      </button>

      {phase === 'armed' && !pending && (
        <>
          {/* Announced, because the only thing that changed for a screen-reader
              user is the button's own label — and the consequence is the part
              worth hearing. */}
          <span role="status" className="text-xs text-navy-500">
            {confirmHint(copy)}
          </span>
          <button
            type="button"
            onClick={() => setPhase('idle')}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-navy-500 underline transition hover:text-navy-900"
          >
            Cancel
          </button>
        </>
      )}
    </span>
  );
}
