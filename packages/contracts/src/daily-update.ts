/**
 * §6.4 `Daily Update` + §10 the publishing / approval state machine.
 *
 * This is the invariant the whole product rests on (§3.2): field submits →
 * contractor reviews and edits the client summary → contractor publishes. A
 * field update MUST NOT be auto-published to the client, and `Internal Notes`
 * MUST NOT be published under any path.
 *
 * The state machine is encoded as an explicit transition table rather than
 * scattered `if` statements so that "is there a path from DRAFT to PUBLISHED
 * that skips PM review?" is a question the tests can answer.
 */

import type { FieldType } from './project-schema.ts';
import { type ManagerApprovalStatus, PUBLISHED_APPROVAL_STATUS } from './enums.ts';

/** §6.4, verbatim. `clientVisible` follows the §6 CV convention. */
export const DAILY_UPDATE_FIELDS: readonly {
  readonly name: string;
  readonly type: FieldType;
  readonly clientVisible: boolean;
  readonly notes?: string;
}[] = [
  { name: 'Project', type: 'text', clientVisible: false, notes: 'Association → Project' },
  { name: 'Update Date', type: 'date', clientVisible: true },
  { name: 'Submitted By', type: 'user', clientVisible: false },
  { name: 'Work Completed', type: 'longtext', clientVisible: false },
  { name: 'Work in Progress', type: 'longtext', clientVisible: false },
  { name: 'Work Planned Next', type: 'longtext', clientVisible: false },
  { name: 'Crew Onsite', type: 'text', clientVisible: false },
  { name: 'Hours Worked', type: 'number', clientVisible: false },
  { name: 'Materials Used', type: 'longtext', clientVisible: false },
  { name: 'Materials Delivered', type: 'longtext', clientVisible: false },
  { name: 'Weather', type: 'text', clientVisible: false },
  { name: 'Inspection Activity', type: 'longtext', clientVisible: false },
  { name: 'Delays', type: 'longtext', clientVisible: false },
  { name: 'Safety Notes', type: 'longtext', clientVisible: false },
  { name: 'Client Decision Needed', type: 'bool', clientVisible: false },
  { name: 'Internal Notes', type: 'longtext', clientVisible: false, notes: '§9.3 — NEVER client-facing, under any path' },
  { name: 'Client Summary', type: 'longtext', clientVisible: true, notes: 'The only publish candidate' },
  { name: 'Client Visible', type: 'bool', clientVisible: false, notes: 'Set to Yes by WF4 only' },
  { name: 'Manager Approval Status', type: 'select', clientVisible: false },
  { name: 'Publish Date', type: 'date', clientVisible: true },
  { name: 'Notify Client', type: 'bool', clientVisible: false },
];

/**
 * §12.2 — the field app surfaces two separate text areas. Only the second is
 * ever a publish candidate; they are distinct fields precisely so that a PM
 * cannot publish the first one by accident.
 */
export const FIELD_APP_NOTE_AREAS = {
  internal: 'Internal Field Notes',
  publishCandidate: 'Suggested Client Progress Summary',
} as const;

/** §10 states. DRAFT exists only in the field app, before WF3 fires. */
export type PublishingState =
  | 'DRAFT'
  | 'PENDING'
  | 'RETURNED'
  | 'APPROVED_INTERNALLY'
  | 'APPROVED_AND_PUBLISHED';

/** §12.1 review actions → the transitions they cause. */
export type PublishingEvent =
  | 'SUBMIT_TO_PM'
  | 'RETURN_FOR_REVISION'
  | 'APPROVE_INTERNALLY'
  | 'APPROVE_AND_PUBLISH'
  | 'EDIT_CLIENT_SUMMARY';

export interface Transition {
  readonly from: PublishingState;
  readonly event: PublishingEvent;
  readonly to: PublishingState;
  /** Who may fire it. Field users can only ever submit (§12.2). */
  readonly actor: 'field' | 'pm';
  readonly notes?: string;
}

/**
 * The complete transition table from §10. Anything not listed here is not a
 * legal move — there is deliberately no DRAFT → APPROVED_AND_PUBLISHED edge and
 * no `field` actor beyond SUBMIT_TO_PM.
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: 'DRAFT', event: 'SUBMIT_TO_PM', to: 'PENDING', actor: 'field', notes: 'WF3: sets Pending, notifies PM, does NOT notify client' },
  { from: 'RETURNED', event: 'SUBMIT_TO_PM', to: 'PENDING', actor: 'field', notes: '§10: Returned goes back to Draft, then resubmits' },
  { from: 'PENDING', event: 'RETURN_FOR_REVISION', to: 'RETURNED', actor: 'pm' },
  { from: 'PENDING', event: 'APPROVE_INTERNALLY', to: 'APPROVED_INTERNALLY', actor: 'pm', notes: 'Client Visible stays No' },
  { from: 'PENDING', event: 'EDIT_CLIENT_SUMMARY', to: 'PENDING', actor: 'pm' },
  { from: 'APPROVED_INTERNALLY', event: 'EDIT_CLIENT_SUMMARY', to: 'APPROVED_INTERNALLY', actor: 'pm' },
  { from: 'APPROVED_INTERNALLY', event: 'APPROVE_AND_PUBLISH', to: 'APPROVED_AND_PUBLISHED', actor: 'pm', notes: 'WF4' },
  { from: 'PENDING', event: 'APPROVE_AND_PUBLISH', to: 'APPROVED_AND_PUBLISHED', actor: 'pm', notes: 'WF4 — PM reviews and publishes in one step' },
];

export type TransitionResult =
  | { readonly ok: true; readonly to: PublishingState }
  | { readonly ok: false; readonly error: string };

export function transition(
  from: PublishingState,
  event: PublishingEvent,
  actor: 'field' | 'pm',
): TransitionResult {
  const match = TRANSITIONS.find((t) => t.from === from && t.event === event);
  if (match === undefined) {
    return { ok: false, error: `§10: no transition ${from} --${event}--> (illegal move)` };
  }
  if (match.actor !== actor) {
    return {
      ok: false,
      error: `§3.2: ${actor} may not fire ${event} (reserved for ${match.actor})`,
    };
  }
  return { ok: true, to: match.to };
}

/** §6.4 select values ↔ §10 states. */
export function toApprovalStatus(state: PublishingState): ManagerApprovalStatus | null {
  switch (state) {
    case 'DRAFT':
      return null;
    case 'PENDING':
      return 'Pending';
    case 'RETURNED':
      return 'Returned';
    case 'APPROVED_INTERNALLY':
      return 'Approved Internally';
    case 'APPROVED_AND_PUBLISHED':
      return PUBLISHED_APPROVAL_STATUS;
  }
}

/** §10 — the only state in which a Daily Update may carry Client Visible = Yes. */
export function isPublished(state: PublishingState): boolean {
  return state === 'APPROVED_AND_PUBLISHED';
}

/**
 * WF4's effects (§11), as data. The publisher applies these; the list exists so
 * a test can assert that publishing sets Client Visible and emits the Client
 * Summary — and nothing about Internal Notes.
 */
export const WF4_PUBLISH_EFFECTS = [
  'set Client Visible = Yes',
  'publish Client Summary',
  'update Project.Last Updated Date',
  'notify client',
  'add to portal feed',
] as const;
