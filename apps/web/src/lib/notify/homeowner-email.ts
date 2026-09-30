/**
 * The homeowner emails, as pure text. No I/O, so the one thing that matters
 * about them can be tested: nothing internal is ever in them.
 */

export type HomeownerEvent =
  | { kind: 'update'; clientSummary: string; publishDate: string }
  | { kind: 'changeOrder'; number: string; title: string; netAmount: number; scheduleImpactDays: number }
  | { kind: 'message'; author: string; body: string };

export interface HomeownerEmailInput {
  event: HomeownerEvent;
  projectName: string;
  projectCode: string | null;
  clientName: string;
  signInUrl: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first === '' ? 'there' : first;
}

/** Subject and HTML body for one event. */
export function buildHomeownerEmail(input: HomeownerEmailInput): { subject: string; html: string } {
  // `projectCode` is deliberately NOT destructured. It is still on the input
  // because callers have it and removing it would churn them, but nothing in
  // this function may reach for it: the password does not go in the email.
  const { event, projectName, clientName, signInUrl } = input;
  const greeting = `Hi ${escapeHtml(firstName(clientName))},`;
  // ── THE CODE IS NOT PRINTED HERE ────────────────────────────────────────
  //
  // It used to be: "sign in with the email this was sent to and your project
  // code BSA-0xx." That code is their PASSWORD. It never expires, it is on
  // their documents, and putting it in the body of every update, change-order
  // and message notification meant the password travelled in every one —
  // forwardable, searchable, sitting in an inbox for years.
  //
  // The reminder that remains says where the code comes from without being the
  // code. Somebody who has lost it asks their contractor, which is one message
  // rather than a standing exposure. (Found in the audit, 2026-09-30. The
  // proper fix is a tapped link instead of a typed code; this stops the
  // bleeding meanwhile.)
  const codeLine =
    `<p style="color:#4a5568;font-size:13px">Sign in with the email this was sent to and your project code — it is on your contract and your invoices. Your contractor can resend it.</p>`;
  const footer = `<p><a href="${escapeHtml(signInUrl)}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open your Project Hub</a></p>${codeLine}<p style="color:#718096;font-size:12px">You are receiving this because ${escapeHtml(projectName)} is your project. Replies go to your contractor.</p>`;

  if (event.kind === 'update') {
    return {
      subject: `${projectName}: progress update`,
      html: `<p>${greeting}</p><p>Your contractor posted a progress update on <strong>${escapeHtml(projectName)}</strong>.</p><blockquote style="border-left:3px solid #cbd5e0;padding:8px 12px 8px 12px;display:block;color:#2d3748">${escapeHtml(event.clientSummary)}</blockquote>${footer}`,
    };
  }
  if (event.kind === 'changeOrder') {
    const impact =
      event.scheduleImpactDays === 0
        ? 'No change to the schedule.'
        : `Schedule impact: ${event.scheduleImpactDays} day${event.scheduleImpactDays === 1 ? '' : 's'}.`;
    const figure =
      event.netAmount < 0
        ? `Credit to you: ${money(Math.abs(event.netAmount))}.`
        : `Added to your contract if approved: ${money(event.netAmount)}.`;
    return {
      subject: `${projectName}: change order ${event.number} needs your decision`,
      html: `<p>${greeting}</p><p>Your contractor sent a change order on <strong>${escapeHtml(projectName)}</strong> and it is waiting on you.</p><p><strong>${escapeHtml(event.number)} · ${escapeHtml(event.title)}</strong><br>${escapeHtml(figure)} ${escapeHtml(impact)}</p><p>Open your Project Hub to read the details and approve or decline.</p>${footer}`,
    };
  }
  return {
    subject: `${projectName}: new message from ${event.author}`,
    html: `<p>${greeting}</p><p><strong>${escapeHtml(event.author)}</strong> sent you a message on <strong>${escapeHtml(projectName)}</strong>:</p><blockquote style="border-left:3px solid #cbd5e0;padding:8px 12px 8px 12px;display:block;color:#2d3748">${escapeHtml(event.body)}</blockquote><p>Reply from your Project Hub and it lands on your contractor's thread.</p>${footer}`,
  };
}
