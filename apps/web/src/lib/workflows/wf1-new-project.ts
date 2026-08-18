import { validateHandoffPayload, type HandoffPayload } from '@buildsuite/contracts';
import { DEFAULT_MILESTONES, DEFAULT_TASKS, INITIAL_PROGRESS } from './defaults.ts';
import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF1 — New Project Setup (§11).
 *
 * Trigger: Opportunity reaches `Estimate Approved`, carrying the §8.2 handoff
 * payload that BuildSuite's Send-to-CRM action stamped onto the Contact.
 *
 * Actions, verbatim from §11: create/update Project · associate Contact ·
 * associate Opportunity · assign PM · create default milestones · create
 * default tasks · set Progress = 10% · internal notification · prepare Client
 * Portal access · record activity.
 */

export interface Wf1Trigger {
  opportunityId: string;
  contactId: string;
  /** The §8.2 payload written onto the Contact at handoff. */
  handoff: unknown;
  /** PM to assign. Absent means unassigned — see below. */
  projectManagerUserId?: string;
  /** True when a Project already exists for this shared key. */
  projectExists: boolean;
}

export const WF1 = 'WF1 New Project Setup';

export function planNewProjectSetup(trigger: Wf1Trigger): WorkflowPlan {
  const issues = validateHandoffPayload(trigger.handoff);
  if (issues.length > 0) {
    // §5 — without a valid shared key there is nothing to key the project on,
    // and creating one anyway would produce a record that can never be matched
    // back to BuildSuite. Refuse rather than inventing an ID.
    return {
      ran: false,
      workflow: WF1,
      skipped: `invalid §8.2 handoff payload: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
    };
  }

  const handoff = trigger.handoff as HandoffPayload;
  const id = handoff.buildsuite_project_id;

  if (trigger.projectExists) {
    // §11 says "create/update". The handoff can legitimately fire twice — a
    // re-sent proposal, a retried webhook — and the second one must not
    // duplicate milestones and tasks. Idempotence is the whole reason this
    // branch exists.
    return {
      ran: true,
      workflow: WF1,
      effects: [
        { type: 'RecordActivity', buildsuiteProjectId: id, activity: 'Handoff received for an existing project — seeding skipped' },
      ],
    };
  }

  const effects: Effect[] = [
    {
      type: 'CreateProject',
      buildsuiteProjectId: id,
      projectName: handoff.project_name,
      projectAddress: handoff.project_address,
      contractAmount: handoff.contract_amount,
      clientName: handoff.client.name,
    },
    { type: 'AssociateContact', buildsuiteProjectId: id, contactId: trigger.contactId },
    { type: 'AssociateOpportunity', buildsuiteProjectId: id, opportunityId: trigger.opportunityId },
  ];

  if (trigger.projectManagerUserId !== undefined) {
    effects.push({
      type: 'AssignProjectManager',
      buildsuiteProjectId: id,
      userId: trigger.projectManagerUserId,
    });
  } else {
    // Don't silently leave it unassigned — an unassigned project has nobody to
    // receive the field-update review queue, which breaks §3.2's approval path.
    effects.push({
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `${handoff.project_name} was created without a project manager — assign one before field work starts`,
    });
  }

  DEFAULT_MILESTONES.forEach((milestoneName, index) => {
    effects.push({
      type: 'CreateMilestone',
      buildsuiteProjectId: id,
      milestoneName,
      sequence: index + 1,
      clientVisible: true,
    });
  });

  for (const task of DEFAULT_TASKS) {
    effects.push({ type: 'CreateTask', buildsuiteProjectId: id, ...task });
  }

  effects.push(
    { type: 'SetProgress', buildsuiteProjectId: id, percentage: INITIAL_PROGRESS },
    {
      type: 'NotifyInternal',
      buildsuiteProjectId: id,
      message: `New project from BuildSuite: ${handoff.project_name} (${id})`,
    },
    { type: 'PrepareClientPortalAccess', buildsuiteProjectId: id, contactId: trigger.contactId },
    { type: 'RecordActivity', buildsuiteProjectId: id, activity: 'Project created from BuildSuite handoff' },
  );

  // §11 WF1 lists no client notification, and that is deliberate — the portal
  // is prepared, not announced. The client hears from the contractor first.
  return { ran: true, workflow: WF1, effects };
}
