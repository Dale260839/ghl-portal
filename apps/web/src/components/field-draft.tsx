'use client';

import { useEffect, useRef, useState } from 'react';
import { useFieldUploads } from '@/components/field-upload-context';
import { DAILY_DRAFT_FIELDS, hasDraftContents, parseFieldDraft, shouldClearFieldDraft, type FieldDraftState } from '@/lib/field-draft-state';

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
 * Drafts can contain internal notes. Keep them per user and tenant in this
 * tab's session storage, expire them after one day, and clear them on sign-out.
 * ---------------------------------------------------------------------------
 */

/**
 * The project is in here because it is part of what they were writing. Restore
 * the words without it and a crew member files Tuesday's basement work against
 * whichever job happens to be first in the list.
 */
const FIELDS = DAILY_DRAFT_FIELDS;

/**
 * One draft, not one per project. A crew member writes one update at a time,
 * and a key per project would leave four half-written days on the phone, each
 * offering itself back on a different selection.
 */
const LEGACY_KEY = 'bs_field_draft:update';

function read(key: string): FieldDraftState | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = parseFieldDraft(raw);
    if (parsed === null) window.sessionStorage.removeItem(key);
    return parsed;
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
    const element = Array.from(form.elements).find((e) =>
      (e instanceof HTMLSelectElement || e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement) &&
      e.name === name && !(e instanceof HTMLInputElement && e.type === 'hidden'));
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

export function FieldDraft({ draftKey }: { draftKey: string | null }) {
  const anchor = useRef<HTMLDivElement>(null);
  const revisionField = useRef<HTMLInputElement>(null);
  const [revision, setRevision] = useState('');
  const [offer, setOffer] = useState<FieldDraftState | null>(null);
  const { restorePhotos } = useFieldUploads();
  const restoring = useRef(false);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!(form instanceof HTMLFormElement)) return;
    setOffer(null);
    // Do not offer the old browser-wide draft to whichever user signs in next.
    try { window.localStorage.removeItem(LEGACY_KEY); } catch {}
    if (draftKey === null) return;

    const existing = read(draftKey);
    const defaults: Record<string, string> = {};
    for (const [name, element] of Object.entries(fieldsIn(form))) {
      defaults[name] = element instanceof HTMLInputElement && element.type === 'checkbox'
        ? (element.defaultChecked ? 'on' : 'off') : element instanceof HTMLSelectElement ? '' : element.defaultValue;
    }
    if (existing !== null && hasDraftContents(existing.values, existing.photoIds, defaults)) {
      setOffer(existing);
    }

    const save = () => {
      if (restoring.current) return;
      setRevision('');
      if (revisionField.current !== null) revisionField.current.value = '';
      try {
        const values: Record<string, string> = {};
        for (const [name, element] of Object.entries(fieldsIn(form))) {
          values[name] = element instanceof HTMLInputElement && element.type === 'checkbox'
            ? (element.checked ? 'on' : 'off') : element.value;
        }
        const photoIds = [...new Set(new FormData(form).getAll('photoId').map(String).filter(Boolean))];
        setOffer(null);
        if (!hasDraftContents(values, photoIds, defaults)) {
          window.sessionStorage.removeItem(draftKey);
          return;
        }
        const previous = read(draftKey);
        const unchanged = previous?.revision !== undefined &&
          JSON.stringify(previous.values) === JSON.stringify(values) &&
          JSON.stringify(previous.photoIds) === JSON.stringify(photoIds);
        const revision = unchanged ? previous.revision! : crypto.randomUUID();
        if (!unchanged) window.sessionStorage.setItem(
          draftKey,
          JSON.stringify({ savedAt: new Date().toISOString(), values, photoIds, revision } satisfies FieldDraftState),
        );
        setRevision(revision);
        if (revisionField.current !== null) revisionField.current.value = revision;
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
  }, [draftKey]);

  function restore() {
    const form = anchor.current?.closest('form');
    if (!(form instanceof HTMLFormElement) || offer === null) return;
    const project = fieldsIn(form).projectId;
    if (project instanceof HTMLSelectElement &&
        !Array.from(project.options).some((o) => o.value === offer.values.projectId)) {
      discard();
      return;
    }
    restoring.current = true;
    for (const [name, element] of Object.entries(fieldsIn(form))) {
      const value = offer.values[name];
      if (typeof value === 'string') {
        if (element instanceof HTMLInputElement && element.type === 'checkbox') element.checked = value === 'on';
        else element.value = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    restorePhotos(offer.photoIds.length > 0 ? { projectId: offer.values.projectId!, photoIds: offer.photoIds } : null);
    restoring.current = false;
    setOffer(null);
    form.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function discard() {
    setRevision('');
    if (revisionField.current !== null) revisionField.current.value = '';
    try {
      if (draftKey !== null) window.sessionStorage.removeItem(draftKey);
    } catch {
      // Nothing to do, and nothing worth saying.
    }
    setOffer(null);
  }

  return (
    <div ref={anchor}>
      <input ref={revisionField} type="hidden" name="draftRevision" value={revision} />
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
export function ClearFieldDraft({ draftKey, submittedRevision }: {
  draftKey: string | null;
  submittedRevision?: string | null;
}) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_KEY);
      // Old success URLs can be revisited after another draft has been started.
      if (draftKey !== null && shouldClearFieldDraft(window.sessionStorage.getItem(draftKey), submittedRevision)) {
        window.sessionStorage.removeItem(draftKey);
      }
    } catch {
      // Nothing to do.
    }
  }, [draftKey, submittedRevision]);

  return null;
}
