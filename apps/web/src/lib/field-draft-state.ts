export const DAILY_DRAFT_FIELDS = [
  'projectId', 'workCompleted', 'internalNotes', 'clientSummary', 'blocker',
  'crewOnsite', 'hoursWorked', 'weather', 'clientDecisionNeeded',
] as const;

export interface FieldDraftState {
  savedAt: string;
  values: Record<string, string>;
  /** References only: no file bytes, storage paths or signed URLs. */
  photoIds: string[];
}

export interface RestoredDraftPhotos {
  projectId: string;
  photoIds: string[];
}

export function parseFieldDraft(raw: string, now = Date.now()): FieldDraftState | null {
  try {
    const draft = JSON.parse(raw);
    if (draft === null || typeof draft !== 'object' || Array.isArray(draft) ||
        typeof draft.savedAt !== 'string') return null;
    const savedAt = Date.parse(draft.savedAt);
    if (!Number.isFinite(savedAt) || now - savedAt > 86_400_000 || savedAt > now) return null;
    if (draft.values === null || typeof draft.values !== 'object' || Array.isArray(draft.values) ||
        Object.values(draft.values).some((value) => typeof value !== 'string')) return null;
    const photos: unknown = draft.photoIds ?? [];
    if (!Array.isArray(photos) || photos.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return null;
    const values: Record<string, string> = {};
    for (const field of DAILY_DRAFT_FIELDS) {
      if (typeof draft.values[field] === 'string') values[field] = draft.values[field];
    }
    if (photos.length > 0 && !values.projectId?.trim()) return null;
    return { savedAt: draft.savedAt, values, photoIds: [...new Set(photos as string[])] };
  } catch {
    return null;
  }
}

export function hasDraftContents(
  values: Record<string, string>, photoIds: readonly string[], defaults: Record<string, string>,
): boolean {
  return photoIds.length > 0 || Object.entries(values).some(([name, value]) =>
    name !== 'projectId' && value.trim() !== (defaults[name] ?? '').trim());
}
