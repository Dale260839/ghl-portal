import { ISSUE_CATEGORIES, type IssueCategory } from '@buildsuite/contracts';
import type { Effect, WorkflowPlan } from './effects.ts';

/**
 * WF7 — Issue Submitted (§11).
 *
 * Trigger: a `Project Issue` is created — by a field user reporting a blocker
 * (WF3 raises one), by a client through the portal, or by a PM directly.
 *
 * Actions, verbatim from §11: assign issue number · notify PM · confirm to
 * reporter · create task when required · escalate urgent safety concerns ·
 * update issue dashboard.
 *
 * The "confirm to reporter" action is the one worth not skipping. A field user
 * who reports a hazard and hears nothing back assumes it went nowhere, and the
 * next hazard doesn't get reported at all.
 */

export interface Wf7Trigger {
  buildsuiteProjectId: string;
  issueId: string;
  issueTitle: string;
  category: string;
  description: string;
  reportedBy: string;
  projectName: string;
  /** Highest existing issue sequence on this project. 0 when it's the first. */
  existingIssueCount: number;
  /** The PM to assign to. Absent means unassigned — flagged, not silent. */
  projectManager?: string;
  /** Set when the issue needs remedial work tracked as its own task. */
  requiresTask?: boolean;
}

export const WF7 = 'WF7 Issue Submitted';

/**
 * `ISS-<project sequence>-<NNN>`, derived from the project ID's own sequence so
 * numbers are meaningful to a human reading a photo of a whiteboard.
 */
export function issueNumberFor(buildsuiteProjectId: string, existingCount: number): string {
  const projectSequence = buildsuiteProjectId.split('-').at(-1) ?? buildsuiteProjectId;
  return `ISS-${projectSequence}-${String(existingCount + 1).padStart(3, '0')}`;
}

/** §6.7 categories that represent a hazard rather than an inconvenience. */
const SAFETY_CATEGORIES: readonly IssueCategory[] = ['Safety Concern'];

export function planIssueSubmitted(trigger: Wf7Trigger): WorkflowPlan {
  if (trigger.buildsuiteProjectId === '' || trigger.issueId === '') {
    return { ran: false, workflow: WF7, skipped: 'issue is missing a project id or issue id' };
  }

  const category = ISSUE_CATEGORIES.find((c) => c === trigger.category);
  if (category === undefined) {
    // §6.7's category list is verbatim. An unrecognised category means the
    // reporting form and the schema have drifted, and silently coercing it to
    // 'Other' would hide that — including for a mis-typed 'Safety Concern',
    // which is the one case where the coercion matters most.
    return {
      ran: false,
      workflow: WF7,
      skipped: `"${trigger.category}" is not a §6.7 issue category`,
    };
  }

  const id = trigger.buildsuiteProjectId;
  const issueNumber = issueNumberFor(id, trigger.existingIssueCount);
  const isSafety = SAFETY_CATEGORIES.includes(category);

  const effects: Effect[] = [
    { type: 'AssignIssueNumber', buildsuiteProjectId: id, issueId: trigger.issueId, issueNumber },
  ];

  if (trigger.projectManager !== undefined && trigger.projectManager.trim() !== '') {
    effects.push({
      type: 'AssignIssue',
      buildsuiteProjectId: id,
      issueId: trigger.issueId,
      assignTo: trigger.projectManager,
    });
  }

  effects.push({
    type: 'NotifyInternal',
    buildsuiteProjectId: id,
    message: `${issueNumber} — ${trigger.issueTitle} (${category}) reported on ${trigger.projectName} by ${trigger.reportedBy}`,
  });

  // §11: confirm to reporter. Closing the loop is what keeps reporting happening.
  effects.push({
    type: 'ConfirmToReporter',
    buildsuiteProjectId: id,
    issueId: trigger.issueId,
    reporter: trigger.reportedBy,
    message: `Logged as ${issueNumber}. Your project manager has been notified.`,
  });

  if (isSafety) {
    effects.push({
      type: 'EscalateIssue',
      buildsuiteProjectId: id,
      issueId: trigger.issueId,
      reason: 'Safety Concern — §11 WF7 escalates these immediately',
    });
  }

  if (trigger.requiresTask === true || isSafety) {
    // A hazard always gets a task, whether or not the reporter thought to ask
    // for one. "Someone will look at it" is not a remediation plan.
    effects.push({
      type: 'CreateTask',
      buildsuiteProjectId: id,
      taskName: `Resolve ${issueNumber}: ${trigger.issueTitle}`,
      assignedTrade: 'General',
    });
  }

  effects.push({
    type: 'RecordActivity',
    buildsuiteProjectId: id,
    activity: `Issue ${issueNumber} submitted by ${trigger.reportedBy}`,
  });

  // §11 WF7 lists no client notification. An issue is internal until a PM
  // writes a Client Update for it — same principle as §10's daily updates.
  return { ran: true, workflow: WF7, effects };
}
