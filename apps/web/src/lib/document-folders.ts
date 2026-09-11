/**
 * Document folders — who a file is filed for.
 *
 * ---------------------------------------------------------------------------
 * THE FOLDER IS THE CATEGORY COLUMN, ON PURPOSE
 *
 * `hub_documents.category` is free text and already carried a loose label
 * (Contract, Permit, Drawing). Nothing read it, so it is the one column that
 * can become the folder without a migration and without losing anything worth
 * keeping. Every existing row keeps its old value and shows as `Unsorted`
 * until someone files it, which is honest: a legacy row genuinely is unfiled.
 *
 * ---------------------------------------------------------------------------
 * TWO AUDIENCES, NOT A TREE
 *
 * A project has exactly one client folder and a field folder per trade. That
 * is the whole shape. Naming the field folders `Field · <Trade>` rather than
 * nesting them keeps the rule a string comparison, so the crew's read-only
 * screen, the homeowner gate and this module cannot disagree about which
 * folder a row is in.
 *
 * The folder is NOT the release switch. `client_visible` still decides whether
 * a homeowner sees a document; the Client folder decides whether it is even a
 * candidate. Both must be true, and a field-folder document can never be
 * released. Two gates, because a single one has been switched on by accident
 * before and the file it exposed was a cost breakdown.
 * ---------------------------------------------------------------------------
 */

/** The one folder a homeowner can ever see into. */
export const CLIENT_FOLDER = 'Client';

/** Field folders are `Field · <Trade>`. Middle dot, one space either side. */
export const FIELD_PREFIX = 'Field · ';

/** What a category that matches no folder is shown as. */
export const UNSORTED_LABEL = 'Unsorted';

export const FIELD_TRADES = [
  'General',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Framing',
  'Drywall',
  'Painting',
  'Flooring',
  'Roofing',
  'Other',
] as const;

export type FieldTrade = (typeof FIELD_TRADES)[number];

export type FolderAudience = 'client' | 'field' | 'unsorted';

export interface ParsedFolder {
  audience: FolderAudience;
  /** Set only when `audience` is `field`. */
  trade?: string;
}

/** `fieldFolder('Electrical')` -> `'Field · Electrical'`. */
export function fieldFolder(trade: string): string {
  return `${FIELD_PREFIX}${trade.trim()}`;
}

/** Where a new document lands unless the contractor picks another folder. */
export const DEFAULT_FOLDER = fieldFolder('General');

/** Every folder, in the order screens list them: Client first, then trades. */
export const ALL_FOLDERS: readonly string[] = [
  CLIENT_FOLDER,
  ...FIELD_TRADES.map((trade) => fieldFolder(trade)),
];

function clean(category: string | null | undefined): string {
  return (category ?? '').trim();
}

export function isClientFolder(category: string | null | undefined): boolean {
  return clean(category) === CLIENT_FOLDER;
}

export function isFieldFolder(category: string | null | undefined): boolean {
  const value = clean(category);
  return value.startsWith(FIELD_PREFIX) && value.length > FIELD_PREFIX.length;
}

/**
 * What the row says versus what a screen shows.
 *
 * A category we do not recognise is not an error and is not hidden. It is a
 * document filed before folders existed, so it reads as `Unsorted` and the
 * contractor is offered a folder to move it to.
 */
export function folderLabel(category: string | null | undefined): string {
  const value = clean(category);
  if (isClientFolder(value)) return CLIENT_FOLDER;
  if (isFieldFolder(value)) return value;
  return UNSORTED_LABEL;
}

export function parseFolder(category: string | null | undefined): ParsedFolder {
  const value = clean(category);
  if (isClientFolder(value)) return { audience: 'client' };
  if (isFieldFolder(value)) {
    return { audience: 'field', trade: value.slice(FIELD_PREFIX.length) };
  }
  return { audience: 'unsorted' };
}

/**
 * Both gates, in one place.
 *
 * The homeowner read and the contractor UI ask the same question, so they ask
 * it of the same function. A released row that was later moved into a field
 * folder — or a legacy released row that was never in the Client folder at all
 * — fails here, which is the leak this function exists to stop.
 */
export function clientCanSeeDocument(document: {
  category: string | null | undefined;
  clientVisible: boolean;
}): boolean {
  return document.clientVisible && isClientFolder(document.category);
}

/** A field-folder document is never a candidate for release. */
export function canBeReleased(category: string | null | undefined): boolean {
  return !isFieldFolder(category);
}
