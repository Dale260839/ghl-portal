'use client';

import { useState, useTransition } from 'react';

import { SubmitButton } from '@/components/submit-button';
import { replyToUpdate } from '@/lib/actions/update-feedback';

/**
 * The contractor's reply to a published update (Dale, 2026-09-24).
 *
 * ---------------------------------------------------------------------------
 * THE CHECKBOX IS THE WHOLE POINT
 *
 * One box, unticked by default: *Send this to the homeowner.* Unticked, the
 * reply is a note on the record — what the PM wants remembered, not said.
 * Ticked, it appears in the portal under the update.
 *
 * Unticked is the default because the cost of the two mistakes is not
 * symmetric. A note that should have been sent can be sent a minute later; a
 * note the homeowner should never have read cannot be unread, and this is the
 * same screen where a PM edits a crew member's blunt words into something a
 * client can see.
 * ---------------------------------------------------------------------------
 */
export function UpdateReply({ updateId }: { updateId: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function send(form: FormData) {
    setError(null);
    form.set('updateId', updateId);
    start(async () => {
      const result = await replyToUpdate(form);
      if (result.ok) {
        setSent(true);
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  if (sent) {
    return <p className="mt-2 text-xs text-emerald-700">Reply saved.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 text-xs font-medium text-navy-600 underline underline-offset-2"
      >
        Reply
      </button>
    );
  }

  return (
    <form action={send} className="mt-2 space-y-2">
      <textarea
        name="body"
        rows={2}
        required
        autoFocus
        placeholder="Your reply"
        className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-300"
      />
      <label className="flex items-center gap-2 text-xs text-navy-600">
        <input type="checkbox" name="clientVisible" className="size-4 rounded border-navy-300" />
        Send this to the homeowner
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton pendingLabel="Saving…" className="min-h-8 px-3 text-xs">
          Save
        </SubmitButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-8 px-2 text-xs font-medium text-navy-500"
        >
          Cancel
        </button>
      </div>
      {error !== null && (
        <p className="text-xs text-amber-700" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
