'use client';

import { useFormStatus } from 'react-dom';

import { useSubmitGate } from '@/components/field-upload-context';

/**
 * The crew's send button, which waits for their photographs.
 *
 * Two reasons it can be disabled, and they read differently on purpose:
 *
 *   · **the form is in flight** — the same protection every other form has, so
 *     a second tap cannot file the day twice;
 *   · **a photo is still uploading** — held, with the count, because sending
 *     now would file the update without a photograph that is seconds away.
 *
 * It never waits on a FAILED upload. A crew member in a basement with no signal
 * must still be able to file their work; the summary above the button tells
 * them what will not be going with it.
 */
export function FieldSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const gate = useSubmitGate();
  const held = !gate.canSubmit;

  return (
    <div className="space-y-2">
      {gate.summary !== null && (
        <p
          className={`text-xs leading-relaxed ${held ? 'text-navy-500' : 'text-amber-700'}`}
          role="status"
        >
          {gate.summary}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || held}
        className="min-h-11 w-full rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : (gate.waitingLabel ?? children)}
      </button>
    </div>
  );
}
