import 'server-only';

import { readGhlConfig, type GhlConfig } from './config.ts';

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
  async findOrCreateContact(email: string, name: string): Promise<string | null> {
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
      source: 'Project Hub invitation',
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
  }): Promise<SendResult> {
    if (!emailSendingEnabled()) {
      return { sent: false, reason: 'disabled', detail: 'GHL_SEND_EMAIL is not true' };
    }

    const contactId = await this.findOrCreateContact(input.email, input.name);
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
  role: 'field' | 'client';
  acceptUrl: string;
}): { subject: string; html: string } {
  const what =
    input.role === 'field'
      ? 'file updates from site and see the work assigned to you'
      : 'follow your project, see progress and read updates as they are published';

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

export function getGhlEmail(): EmailResult {
  const result = readGhlConfig();
  if (!result.configured) return { available: false, missing: result.missing };
  if (result.config.locationId.trim() === '') {
    return { available: false, missing: ['GHL_LOCATION_ID'] };
  }
  return { available: true, email: new GhlEmail(result.config) };
}
