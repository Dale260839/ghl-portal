import 'server-only';

import { readGhlConfig, withLocationToken, type GhlConfig  } from './config.ts';

/**
 * Sending email through GoHighLevel.
 *
 * The invitation flow shipped with no sender: the contractor was handed the link
 * to send themselves. That was honest scaffolding and it is not what anybody
 * wants — an invitation you have to copy and paste is one nobody sends.
 *
 * GoHighLevel is the right channel rather than a new provider: it is already in
 * the stack, it already holds the contact, and a homeowner who later replies to
 * that email lands in the same conversation thread the contractor already uses.
 * No new credential, no new deliverability reputation to build.
 *
 * ---------------------------------------------------------------------------
 * SENDING EMAIL IS A WRITE TO A LIVE SYSTEM, AND IT REACHES A REAL PERSON.
 *
 * Everything else the Hub does to GoHighLevel is a read. This puts a message in
 * somebody's inbox, and an accidental send cannot be recalled. So:
 *
 *   · it refuses unless `GHL_SEND_EMAIL=true`, off by default
 *   · it never creates a contact silently on a bare guess — a contact is looked
 *     up by exact email and only created when there is none
 *   · the caller passes the address; nothing here iterates a list
 * ---------------------------------------------------------------------------
 */

export function emailSendingEnabled(): boolean {
  return process.env.GHL_SEND_EMAIL === 'true';
}

export type SendResult =
  | { sent: true; contactId: string; messageId: string | null }
  | { sent: false; reason: 'disabled' | 'unconfigured' | 'failed'; detail: string };

export class GhlEmail {
  private readonly config: GhlConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GhlConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Version: this.config.apiVersion,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async call(method: string, path: string, body?: unknown) {
    const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  }

  /**
   * The GoHighLevel contact for an address, creating one only if none exists.
   *
   * Exact match on a normalized address. Never a name — two homeowners called
   * "John Smith" are two people, and picking the wrong one sends somebody else's
   * invitation to a stranger.
   */
  async findOrCreateContact(
    email: string,
    name: string,
    source = 'Project Hub invitation',
  ): Promise<string | null> {
    const normalized = email.trim().toLowerCase();
    if (normalized === '') return null;

    const found = await this.call('POST', '/contacts/search', {
      locationId: this.config.locationId,
      pageLimit: 5,
      filters: [{ field: 'email', operator: 'eq', value: normalized }],
    });

    if (found.ok) {
      try {
        const body = JSON.parse(found.text) as { contacts?: { id: string; email?: string }[] };
        const exact = (body.contacts ?? []).find(
          (c) => (c.email ?? '').trim().toLowerCase() === normalized,
        );
        if (exact !== undefined) return exact.id;
      } catch {
        // Fall through to creating one. A malformed search response is not a
        // reason to refuse to invite somebody.
      }
    }

    const created = await this.call('POST', '/contacts/', {
      locationId: this.config.locationId,
      email: normalized,
      name: name.trim() === '' ? normalized : name.trim(),
      source,
    });
    if (!created.ok) return null;

    try {
      const body = JSON.parse(created.text) as { contact?: { id: string } };
      return body.contact?.id ?? null;
    } catch {
      return null;
    }
  }

  async send(input: {
    email: string;
    name: string;
    subject: string;
    html: string;
    /** Recorded on a GoHighLevel contact this send has to create. */
    source?: string;
  }): Promise<SendResult> {
    if (!emailSendingEnabled()) {
      return { sent: false, reason: 'disabled', detail: 'GHL_SEND_EMAIL is not true' };
    }

    const contactId = await this.findOrCreateContact(input.email, input.name, input.source);
    if (contactId === null) {
      return { sent: false, reason: 'failed', detail: 'could not find or create the contact' };
    }

    const result = await this.call('POST', '/conversations/messages', {
      type: 'Email',
      contactId,
      subject: input.subject,
      html: input.html,
      emailTo: input.email.trim().toLowerCase(),
    });

    if (!result.ok) {
      return { sent: false, reason: 'failed', detail: `${result.status} ${result.text.slice(0, 200)}` };
    }

    let messageId: string | null = null;
    try {
      const body = JSON.parse(result.text) as { messageId?: string; msg?: string };
      messageId = body.messageId ?? null;
    } catch {
      // A send that succeeded but whose body we could not parse is still a send.
    }
    return { sent: true, contactId, messageId };
  }
}

/**
 * The invitation email.
 *
 * Deliberately plain. It is a transactional message that has to survive a spam
 * filter and be read on a phone on a job site, not a newsletter — and the link
 * is the only thing on the page that matters, so nothing competes with it.
 */
export function invitationEmail(input: {
  inviterName: string;
  companyName: string;
  /**
   * Field crew only. The homeowner branch was removed on 2026-09-10 when
   * clients stopped being invited — their project code is their password and
   * BuildSuite emails it on signature, so no invitation reaches them. Copy for
   * a role nobody can be invited as is copy that gets read as still true.
   */
  role: 'field';
  acceptUrl: string;
}): { subject: string; html: string } {
  const what = 'file updates from site and see the work assigned to you';

  const company = input.companyName === '' ? 'your contractor' : input.companyName;

  return {
    subject: `${company} has invited you to the Project Hub`,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a1f44;max-width:520px">
  <p>Hello,</p>
  <p>${escapeHtml(input.inviterName)} at ${escapeHtml(company)} has invited you to the Project Hub, where you can ${what}.</p>
  <p style="margin:28px 0">
    <a href="${input.acceptUrl}" style="background:#0a1f44;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Set your password</a>
  </p>
  <p style="font-size:13px;color:#5b6b8c">This link works once and expires in seven days. If the button does not open, copy this address into your browser:</p>
  <p style="font-size:12px;color:#5b6b8c;word-break:break-all">${input.acceptUrl}</p>
  <p style="font-size:13px;color:#5b6b8c">If you were not expecting this, you can ignore it and nothing will happen.</p>
</div>`.trim(),
  };
}

/**
 * The password-reset email, for a field worker (2026-09-15).
 *
 * The same link mechanism as an invitation, so the same plain shape. It says
 * the two things a person needs when they did NOT ask for it: their current
 * password still works, and ignoring this changes nothing.
 */
export function passwordResetEmail(input: {
  inviterName: string;
  companyName: string;
  resetUrl: string;
}): { subject: string; html: string } {
  const company = input.companyName === '' ? 'your contractor' : input.companyName;
  return {
    subject: `Set a new password for the ${company} Project Hub`,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a1f44;max-width:520px">
  <p>Hello,</p>
  <p>${escapeHtml(input.inviterName)} at ${escapeHtml(company)} has sent you a link to set a new password for the Project Hub.</p>
  <p style="margin:28px 0">
    <a href="${input.resetUrl}" style="background:#0a1f44;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Set a new password</a>
  </p>
  <p style="font-size:13px;color:#5b6b8c">This link works once and expires in 24 hours. If the button does not open, copy this address into your browser:</p>
  <p style="font-size:12px;color:#5b6b8c;word-break:break-all">${input.resetUrl}</p>
  <p style="font-size:13px;color:#5b6b8c">If you did not expect this, ignore it — your current password keeps working until you choose a new one.</p>
</div>`.trim(),
  };
}

/**
 * An appointment, for the contractor, the tagged crew member, or the homeowner
 * (John, 2026-09-17). See `lib/schedule-assignees.ts` for who receives it.
 *
 * THE HOMEOWNER'S COPY IS NARROWER, and that is enforced here, not only by the
 * caller: it never carries the team notes, which the portal does not show a
 * homeowner either, and it has no link, because the appointment is internal
 * until the contractor releases it and the portal would show them nothing.
 *
 * The project reference is passed in rather than chosen here. A homeowner must
 * be given `project_code`, never the award code (Sing, 2026-09-12), and this
 * file is covered by the guardrail that holds every client-facing surface to
 * that.
 */
export function appointmentEmail(input: {
  audience: 'contractor' | 'crew' | 'homeowner';
  companyName: string;
  projectReference: string;
  title: string;
  when: string | null;
  status: string;
  assigneeLabel: string;
  notes: string;
  /** Where the reader opens it. Ignored for a homeowner. */
  openUrl: string | null;
}): { subject: string; html: string } {
  const company = input.companyName.trim() === '' ? 'your contractor' : input.companyName.trim();
  const when = input.when ?? 'Date to be confirmed';
  const homeowner = input.audience === 'homeowner';

  const subject = homeowner
    ? `${company}: ${input.title} — ${when}`
    : `Appointment: ${input.title} — ${when}${input.projectReference === '' ? '' : ` (${input.projectReference})`}`;

  const intro =
    input.audience === 'contractor'
      ? `An appointment was added to the schedule for ${escapeHtml(input.assigneeLabel)}.`
      : input.audience === 'crew'
        ? `${escapeHtml(company)} has scheduled you for an appointment.`
        : `${escapeHtml(company)} has scheduled an appointment on your project.`;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#5b6b8c;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0">${value}</td></tr>`;

  const rows = [
    row('What', escapeHtml(input.title)),
    row('When', escapeHtml(when)),
    input.projectReference === '' ? '' : row('Project', escapeHtml(input.projectReference)),
    homeowner ? '' : row('Tagged', escapeHtml(input.assigneeLabel)),
    row('Status', escapeHtml(input.status)),
    // Never for a homeowner: these are the crew's instructions.
    !homeowner && input.notes.trim() !== '' ? row('Notes', escapeHtml(input.notes.trim())) : '',
  ].join('');

  const button =
    !homeowner && input.openUrl !== null
      ? `<p style="margin:24px 0"><a href="${escapeHtml(input.openUrl)}" style="background:#0a1f44;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-weight:600">Open in Project Hub</a></p>`
      : '';

  return {
    subject,
    html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0a1f44;max-width:520px">
  <p>Hello,</p>
  <p>${intro}</p>
  <table style="border-collapse:collapse;font-size:14px">${rows}</table>
  ${button}
  <p style="font-size:13px;color:#5b6b8c">${homeowner ? `If this time does not work for you, reply to this email or contact ${escapeHtml(company)}.` : 'Sent by Project Hub.'}</p>
</div>`.trim(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type EmailResult =
  | { available: true; email: GhlEmail }
  | { available: false; missing: string[] };

export function getGhlEmail(sessionLocationId?: string | null): EmailResult {
  const result = readGhlConfig();
  if (!result.configured) return { available: false, missing: result.missing };
  // That sub-account's own token when one is configured (GHL_LOCATION_TOKENS).
  // A Private Integration token only opens its own sub-account, so sending for
  // another contractor with the default token is a guaranteed 401 — the same
  // fault the invoice rail hit on 2026-09-17. Without an entry the default
  // token stands, so the sub-account it belongs to is unaffected.
  const config = withLocationToken(result.config, sessionLocationId);
  if (config.locationId.trim() === '') {
    return { available: false, missing: ['GHL_LOCATION_ID'] };
  }
  return { available: true, email: new GhlEmail(config) };
}
