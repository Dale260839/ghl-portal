'use client';

import { useState, useTransition } from 'react';

import { SubmitButton } from '@/components/submit-button';
import { acknowledgeUpdate, commentOnUpdate } from '@/lib/actions/update-feedback';

/**
 * "Got it", and a question — the homeowner's half of an update
 * (Dale, 2026-09-24).
 *
 * ---------------------------------------------------------------------------
 * WHY BOTH, AND WHY ACKNOWLEDGE COMES FIRST
 *
 * A homeowner reading an update has two things they might want to do, and they
 * are very different sizes. "Got it" is a tap and costs them nothing. A
 * question is typing, on a phone, about work they may not have words for.
 *
 * Putting the tap first means the common case — *I read it, thanks* — takes one
 * touch, and the PM learns the thing they most wanted to know: that it was
 * read at all. Before this, publishing an update was shouting into a room with
 * the lights off.
 *
 * ONCE ACKNOWLEDGED, THE BUTTON GOES. It does not become a disabled button or
 * a spinner that never resolves: it becomes a sentence saying it was received.
 * A control that stays after it has been used invites a second press and
 * teaches nobody anything.
 * ---------------------------------------------------------------------------
 */

interface Props {
  projectId: string;
  updateId: string;
  /** Already acknowledged by this homeowner, from the server. */
  acknowledged: boolean;
  /** How many comments are already on this update, theirs and the contractor's. */
  replies: number;
}

export function UpdateFeedback({ projectId, updateId, acknowledged, replies }: Props) {
  const [done, setDone] = useState(acknowledged);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function acknowledge() {
    setError(null);
    start(async () => {
      const data = new FormData();
      data.set('projectId', projectId);
      data.set('updateId', updateId);
      const result = await acknowledgeUpdate(data);
      if (result.ok) setDone(true);
      else setError(result.error);
    });
  }

  function send(form: FormData) {
    setError(null);
    form.set('projectId', projectId);
    form.set('updateId', updateId);
    start(async () => {
      const result = await commentOnUpdate(form);
      if (result.ok) {
        setSent(true);
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="mt-4 border-t border-navy-100 pt-3.5">
      <div className="flex flex-wrap items-center gap-3">
        {done ? (
          <span className="text-xs font-medium text-emerald-700">
            You marked this as read{replies > 0 ? '' : ' — your contractor can see that'}
          </span>
        ) : (
          <button
            type="button"
            onClick={acknowledge}
            disabled={pending}
            className="min-h-9 rounded-lg bg-navy-900 px-3.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Got it'}
          </button>
        )}

        {!open && !sent && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-9 rounded-lg border border-navy-200 px-3.5 text-xs font-semibold text-navy-900"
          >
            Ask a question
          </button>
        )}

        {sent && (
          <span className="text-xs text-navy-500">
            Sent to your contractor. They will reply here or by message.
          </span>
        )}
      </div>

      {open && (
        <form action={send} className="mt-3 space-y-2">
          <textarea
            name="body"
            rows={3}
            required
            autoFocus
            placeholder="Anything you want to ask about this update"
            className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-300"
          />
          <div className="flex items-center gap-2">
            <SubmitButton pendingLabel="Sending…" className="min-h-9 px-3.5 text-xs">
              Send
            </SubmitButton>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-9 px-2 text-xs font-medium text-navy-500"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error !== null && (
        <p className="mt-2 text-xs text-amber-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
