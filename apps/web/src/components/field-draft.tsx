'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The crew's half-written update, kept while they write it.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROTECTS
 *
 * A daily update is five fields of typing, done one-handed, on a phone, at the
 * end of a physical day. Between starting and sending it, any of these ends the
 * attempt: a call comes in and the browser is evicted from memory, the battery
 * dies, the signal drops and the submit fails, or they tap away to check a
 * photo. Every one of those lost the lot.
 *
 * So what they type is kept on their own phone as they type it, and offered
 * back when they return.
 *
 * WHY IT ASKS RATHER THAN RESTORING SILENTLY
 *
 * Yesterday's text appearing in today's form, unannounced, is worse than an
 * empty form — they would file yesterday's work as today's without noticing.
 * So it is a question, with the date it was written, and discarding is one tap.
 *
 * NOTHING SENSITIVE LIVES HERE. It is the crew's own words, on the crew's own
 * device, cleared the moment the update is filed. It is never read by the
 * server and never leaves the phone.
 * ---------------------------------------------------------------------------
 */

/**
 * The project is in here because it is part of what they were writing. Restore
 * the words without it and a crew member files Tuesday's basement work against
 * whichever job happens to be first in the list.
 */
const FIELDS = ['projectId', 'workCompleted', 'internalNotes', 'clientSummary', 'blocker'] as const;

/**
 * One draft, not one per project. A crew member writes one update at a time,
 * and a key per project would leave four half-written days on the phone, each
 * offering itself back on a different selection.
 */
const KEY = 'bs_field_draft:update';

interface Draft {
  savedAt: string;
  values: Record<string, string>;
}

function read(): Draft | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Draft;
    return typeof parsed?.savedAt === 'string' && parsed.values ? parsed : null;
  } catch {
    // Private mode, cleared storage, a corrupted value. A draft is a
    // convenience; nothing here may throw its way onto the screen.
    return null;
  }
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function fieldsIn(form: HTMLFormElement): Record<string, Field> {
  const found: Record<string, Field> = {};
  for (const name of FIELDS) {
    const element = form.elements.namedItem(name);
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      found[name] = element;
    }
  }
  return found;
}

export function FieldDraft() {
  const anchor = useRef<HTMLDivElement>(null);
  const [offer, setOffer] = useState<Draft | null>(null);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!(form instanceof HTMLFormElement)) return;

    const existing = read();
    // The project alone is not a draft — the dropdown always has a value.
    const written = ({ projectId: _project, ...words }: Record<string, string>) =>
      Object.values(words).some((v) => v.trim() !== '');
    if (existing !== null && written(existing.values)) {
      setOffer(existing);
    }

    const save = () => {
      try {
        const values: Record<string, string> = {};
        for (const [name, element] of Object.entries(fieldsIn(form))) values[name] = element.value;
        const { projectId: _project, ...words } = values;
        if (Object.values(words).every((v) => v.trim() === '')) {
          window.localStorage.removeItem(KEY);
          return;
        }
        window.localStorage.setItem(
          KEY,
          JSON.stringify({ savedAt: new Date().toISOString(), values } satisfies Draft),
        );
      } catch {
        // Storage full or blocked. Typing must not break because a draft
        // cannot be kept.
      }
    };

    // On input rather than on a timer: a timer that has not fired yet is the
    // twenty minutes somebody loses.
    form.addEventListener('input', save);
    // A <select> fires change, not input, in some browsers.
    form.addEventListener('change', save);
    return () => {
      form.removeEventListener('input', save);
      form.removeEventListener('change', save);
    };
  }, []);

  function restore() {
    const form = anchor.current?.closest('form');
    if (!(form instanceof HTMLFormElement) || offer === null) return;
    for (const [name, element] of Object.entries(fieldsIn(form))) {
      const value = offer.values[name];
      if (typeof value === 'string') element.value = value;
    }
    setOffer(null);
  }

  function discard() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing to do, and nothing worth saying.
    }
    setOffer(null);
  }

  return (
    <div ref={anchor}>
      {offer !== null && (
        <div className="rounded-lg border border-amber-600/25 bg-amber-soft px-3.5 py-3 text-xs text-amber-800">
          <p className="font-medium">
            You started an update on this project and did not send it.
          </p>
          <p className="mt-0.5 text-amber-700">
            Saved {new Date(offer.savedAt).toLocaleString(undefined, {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={restore}
              className="min-h-8 rounded-md bg-amber-700 px-2.5 font-semibold text-white"
            >
              Bring it back
            </button>
            <button type="button" onClick={discard} className="min-h-8 px-2 font-medium text-amber-700">
              Discard it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Clears the draft once the update is actually filed.
 *
 * On the Today screen, where `submitFieldUpdate` lands after a successful
 * submission — not on submit. A submission that fails must leave the draft
 * exactly where it was, which is the whole point of keeping one.
 */
export function ClearFieldDraft() {
  useEffect(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing to do.
    }
  }, []);

  return null;
}
