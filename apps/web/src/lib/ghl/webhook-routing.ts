import type { WebhookEvent } from './webhook.ts';

/**
 * Which workflow a verified webhook belongs to.
 *
 * Kept apart from both the verification and the planners: verification decides
 * whether to trust the payload, this decides what it means, and the planners
 * decide what to do. Three questions, three places, each testable alone.
 *
 * ---------------------------------------------------------------------------
 * **Unrecognised events are ACCEPTED and ignored, not refused.** GHL will send
 * event types we have no planner for, and a 4xx tells the sender we are broken.
 * A webhook that 4xxs on unknown types gets disabled by whoever is watching the
 * delivery log, and then the ones we *do* handle stop arriving too.
 *
 * **Unmapped is not the same as unverified.** Everything reaching this module
 * has already passed the signature check.
 * ---------------------------------------------------------------------------
 */

/** The workflows a GHL event can currently start. */
export type RoutedWorkflow = 'WF1' | 'WF2' | 'WF3' | 'WF4' | 'WF5' | 'WF6' | 'WF7' | 'WF8';

export type Routing =
  | { handled: true; workflow: RoutedWorkflow; why: string }
  | { handled: false; why: string };

/**
 * Event type → workflow.
 *
 * GHL's exact event names are **NOT YET CONFIRMED** — we have never received a
 * real webhook, because the secret does not exist yet. These are the documented
 * shapes plus the obvious variants, and `normalise` makes matching tolerant of
 * case and separators so a near-miss still lands.
 *
 * Once a real delivery arrives, replace this with what GHL actually sends. The
 * unmatched branch logs the type precisely so the first real event tells us.
 */
const BY_TYPE: Record<string, { workflow: RoutedWorkflow; why: string }> = {
  // §11 WF1 — the handoff landing. This is the far end of BuildSuite's
  // Send-to-CRM: the deal was signed, GoHighLevel created the operational
  // Project stamped with the shared key, and this is GHL telling us so.
  //
  // WF1's own trigger is documented as "Opportunity reaches Estimate Approved",
  // so both shapes route here — whether GHL announces the new record or the
  // stage that produced it, the Hub's job is the same and WF1 is idempotent on
  // the shared key.
  projecthandoffreceived: { workflow: 'WF1', why: 'a signed deal was handed over from BuildSuite' },
  projectcreated: { workflow: 'WF1', why: 'a Project record was created in GHL' },
  estimateapproved: { workflow: 'WF1', why: 'an opportunity reached Estimate Approved' },
  opportunityestimateapproved: { workflow: 'WF1', why: 'an opportunity reached Estimate Approved' },

  // §11 WF2 — the stage sync. D4 §5: stage movement happens in GHL and the Hub
  // reflects it, so this is the event that keeps us honest.
  opportunitystagechange: { workflow: 'WF2', why: 'opportunity stage changed in GHL' },
  opportunitystatusupdate: { workflow: 'WF2', why: 'opportunity status changed in GHL' },
  opportunityupdate: { workflow: 'WF2', why: 'opportunity updated in GHL' },

  dailyupdatecreated: { workflow: 'WF3', why: 'a field update was submitted' },
  dailyupdateapproved: { workflow: 'WF4', why: 'a field update was approved for publication' },
  selectionapproved: { workflow: 'WF5', why: 'a client approved a selection' },
  changeorderapproved: { workflow: 'WF6', why: 'a client approved a change order' },
  projectissuecreated: { workflow: 'WF7', why: 'an issue was raised' },
  projectcompleted: { workflow: 'WF8', why: 'the project reached Completed' },
};

/** Lowercase, strip separators — so `Opportunity.StageChange` matches. */
function normalise(type: string): string {
  return type.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function routeWebhook(event: WebhookEvent): Routing {
  const match = BY_TYPE[normalise(event.type)];
  if (match === undefined) {
    return { handled: false, why: `no workflow is mapped to "${event.type}"` };
  }

  // A verified event with no location cannot be scoped to a tenant, and every
  // planner needs one. Refusing here beats a planner guessing.
  if (event.locationId === null) {
    return { handled: false, why: `"${event.type}" carried no locationId — cannot scope it` };
  }

  return { handled: true, workflow: match.workflow, why: match.why };
}

/** The event types we currently understand. Surfaced for the ask to Pat. */
export function mappedEventTypes(): string[] {
  return Object.keys(BY_TYPE);
}
