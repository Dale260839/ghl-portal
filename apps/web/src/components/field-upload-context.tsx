'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { countUploads, submitGate, type UploadCounts } from '@/lib/field-upload-state';

/**
 * The uploader tells the form whether it is ready to be sent.
 *
 * ---------------------------------------------------------------------------
 * WHY A CONTEXT AND NOT A PROP
 *
 * The uploader and the send button are separated by the form's own markup —
 * fields, labels, a server-rendered layout in between. Threading state through
 * that means every screen with an uploader has to hold the wiring correctly,
 * and the one that gets it wrong is the one that silently drops photographs.
 *
 * So the uploader publishes its state and the button subscribes, and the
 * screens in between do not participate.
 *
 * Upload-only screens do not need a provider. Both daily and task update forms
 * use it so neither can submit while photographs are still in flight.
 * ---------------------------------------------------------------------------
 */

interface UploadStatus {
  counts: UploadCounts;
  report: (counts: UploadCounts) => void;
}

const EMPTY: UploadCounts = { saved: 0, inFlight: 0, failed: 0 };

const Context = createContext<UploadStatus>({ counts: EMPTY, report: () => {} });

export function FieldUploadProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<UploadCounts>(EMPTY);
  const value = useMemo<UploadStatus>(
    () => ({
      counts,
      report: (next) =>
        // Only when something actually moved. The uploader reports on every
        // render of its list, and setting state unconditionally from a child's
        // effect is how a render loop starts.
        setCounts((prev) =>
          prev.saved === next.saved && prev.inFlight === next.inFlight && prev.failed === next.failed
            ? prev
            : next,
        ),
    }),
    [counts],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useFieldUploads(): UploadStatus {
  return useContext(Context);
}

/** Convenience for the button: the decision, already made. */
export function useSubmitGate() {
  return submitGate(useFieldUploads().counts);
}

export { countUploads };
