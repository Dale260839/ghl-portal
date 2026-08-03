/**
 * Field names in ARCHITECTURE.md §6 are written in GHL's display casing
 * ("Internal Notes"). The same field arrives as `internal_notes` from a webhook
 * payload and `internalNotes` from a TypeScript surface. Matching on a
 * normalized key means the §9.3 deny-list catches all three spellings rather
 * than only the one the doc happens to use.
 */

/** `Internal Notes` / `internal_notes` / `internalNotes` → `internalnotes`. */
export function normalizeFieldName(fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
