/**
 * "Your crew sent something" — the email a PM gets when field work arrives
 * (John, 2026-09-19).
 *
 * Until now nothing announced a submission at all: an update landed in the
 * review queue and the only way to learn about it was to go and look. A crew
 * member who has finished a job and is waiting on a decision has no way to
 * make that visible, and a PM cannot open a queue they do not know has
 * anything in it.
 *
 * It goes to the CONTRACTOR, never to the homeowner: a submission is pending
 * review by definition, and §12.2 exists so that nothing reaches a client
 * before a person has approved it. The crew's own words are quoted here
 * because the PM is the reviewer — and for the same reason, the suggested
 * client summary is not: it is a draft for them to edit, not a notification.
 *
 * Pure, so the wording is tested without a mailbox.
 */

export interface FieldSubmission {
  /** 'task' when it came from an assigned task, 'daily' from the Update screen. */
  kind: 'task' | 'daily';
  companyName: string;
  projectName: string;
  /** The contractor's code for the project. Never a raw id. */
  projectReference: string;
  submittedBy: string;
  /** Only for a task submission. */
  taskName?: string;
  /** What the crew wrote. */
  workCompleted: string;
  blocker: string;
  photoCount: number;
  /** Whether the crew flagged that the client must decide something. */
  clientDecisionNeeded?: boolean;
  /** Where the PM reviews it. */
  reviewUrl: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildFieldSubmissionEmail(input: FieldSubmission): { subject: string; html: string } {
  const project = input.projectReference === ''
    ? input.projectName
    : `${input.projectName} (${input.projectReference})`;

  // The subject carries the thing a PM decides on: a blocker first, because it
  // is the one that stops work, then whose job it is.
  const urgent = input.blocker.trim() !== '';
  const subject = urgent
    ? `Blocker on ${project} — ${input.submittedBy}`
    : `${input.submittedBy} sent an update on ${project}`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#5b6b8c;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${value}</td></tr>`;

  const rows = [
    row('Project', escapeHtml(project)),
    input.kind === 'task' && (input.taskName ?? '').trim() !== ''
      ? row('Task', escapeHtml((input.taskName ?? '').trim()))
      : '',
    row('From', escapeHtml(input.submittedBy)),
    input.workCompleted.trim() === '' ? '' : row('Work', escapeHtml(input.workCompleted.trim())),
    input.photoCount > 0
      ? row('Photos', `${input.photoCount} added`)
      : '',
    input.clientDecisionNeeded === true ? row('Flagged', 'The client needs to decide something') : '',
  ].join('');

  const blockerBlock = urgent
    ? `<p style="margin:16px 0;padding:12px 14px;border-left:3px solid #b45309;background:#fffbeb"><strong>Blocker:</strong> ${escapeHtml(input.blocker.trim())}</p>`
    : '';

  const button =
    input.reviewUrl === null
      ? ''
      : `<p style="margin:24px 0"><a href="${escapeHtml(input.reviewUrl)}" style="background:#0a1f44;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Review it</a></p>`;

  return {
    subject,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a1f44;max-width:520px">
  <p>Hello,</p>
  <p>${escapeHtml(input.submittedBy)} submitted field work for your review. Nothing reaches the homeowner until you publish it.</p>
  <table style="border-collapse:collapse;font-size:14px">${rows}</table>
  ${blockerBlock}
  ${button}
  <p style="font-size:13px;color:#5b6b8c">Sent by Project Hub${input.companyName.trim() === '' ? '' : ` for ${escapeHtml(input.companyName.trim())}`}.</p>
</div>`.trim(),
  };
}
