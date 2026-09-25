'use client';

import { useState, useTransition } from 'react';

import { setUpdatePhotoRelease } from '@/lib/actions/update-photos';

/**
 * The PM's per-photo release switch, on the update they are reviewing.
 *
 * A switch rather than a form with a Save button: the decision is one bit and
 * a person makes it a dozen times in a row. Making each one a two-step is how
 * a PM stops bothering and publishes text only, which is what happened before
 * the photographs were on this screen at all.
 *
 * It says what is true now — "Client can see this" / "Internal" — rather than
 * what pressing it would do. A control labelled with its own action leaves
 * somebody reading a grid of six wondering which state each one is in.
 */
export function PhotoRelease({
  photoId,
  released,
}: {
  photoId: string;
  released: boolean;
}) {
  const [on, setOn] = useState(released);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    // Optimistic: the switch moves now and goes back if the server refuses.
    // A checkbox that waits for a round trip feels broken on a phone.
    setOn(next);
    start(async () => {
      const data = new FormData();
      data.set('photoId', photoId);
      if (next) data.set('release', 'on');
      const result = await setUpdatePhotoRelease(data);
      if (!result.ok) {
        setOn(!next);
        setError(result.error);
      }
    });
  }

  return (
    <>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          checked={on}
          disabled={pending}
          onChange={(e) => toggle(e.currentTarget.checked)}
          className="size-3.5 rounded border-navy-300"
        />
        <span className={on ? 'font-medium text-emerald-700' : 'text-navy-400'}>
          {on ? 'Client can see this' : 'Internal'}
        </span>
      </label>
      {error !== null && (
        <p className="text-xs text-amber-700" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
