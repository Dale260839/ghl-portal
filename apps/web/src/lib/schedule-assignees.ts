/**
 * Who an appointment is for, and who hears about it (John, 2026-09-17).
 *
 * "The trade or crew should be a dropdown. The list should include the
 * homeowner and the crews. Still optional. When details are added, the
 * appointment is emailed to the contractor's email and to the tagged trade or
 * crew."
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED
 *
 * `hub_schedule_items.trade` is free text, and stays the only column: no schema
 * change. The dropdown posts a KEY — `homeowner`, `crew:<membership id>`, or
 * `earlier` for a value typed before the dropdown existed — and the server
 * turns it back into a person from its own reads. An email address is never
 * taken from the form, so the form cannot be used to mail a stranger.
 *
 * What lands in `trade` is a readable LABEL: "Homeowner — Dana Johnson", or the
 * crew member's name. A crew member with no name set is stored by email, which
 * is why the portal passes `trade` through `portalSafeTrade` — a homeowner
 * never reads a crew member's address.
 *
 * Pure: every input is passed in, so the whole rule is tested without a
 * request, a database or an inbox.
 * ---------------------------------------------------------------------------
 */

export interface CrewCandidate {
  id: string;
  email: string;
  fullName: string;
  role: string;
  revoked: boolean;
}

export interface Assignee {
  /** What the dropdown posts. */
  key: string;
  /** What is saved to `trade`, and matched against it when editing. */
  label: string;
  /** What the contractor reads in the dropdown. */
  display: string;
  kind: 'homeowner' | 'crew' | 'earlier';
  /** Crew only — the membership, so the server can find the address itself. */
  membershipId?: string;
}

export interface AssigneeChoices {
  homeowner: Assignee;
  crew: Assignee[];
}

export const EARLIER_KEY = 'earlier';

export function assigneeChoices(input: {
  clientName: string;
  crew: readonly CrewCandidate[];
}): AssigneeChoices {
  const name = input.clientName.trim();
  const homeowner: Assignee = {
    key: 'homeowner',
    label: name === '' ? 'Homeowner' : `Homeowner — ${name}`,
    display: name === '' ? 'Homeowner' : `${name} (homeowner)`,
    kind: 'homeowner',
  };

  // Field crew only, and nobody whose access has been revoked: tagging them
  // would email someone locked out of the project.
  const crew = input.crew
    .filter((m) => m.role === 'field' && !m.revoked && m.email.trim() !== '')
    .map((m): Assignee => {
      const fullName = m.fullName.trim();
      const email = m.email.trim();
      return {
        key: `crew:${m.id}`,
        label: fullName === '' ? email : fullName,
        display: fullName === '' ? email : `${fullName} — ${email}`,
        kind: 'crew',
        membershipId: m.id,
      };
    })
    .sort((a, b) => a.display.localeCompare(b.display));

  return { homeowner, crew };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which option an existing appointment shows as selected.
 *
 * A value typed before the dropdown existed ("Electrician") matches nobody. It
 * is offered back as its own option, selected, so saving an unrelated change
 * does not silently wipe it.
 */
export function currentAssignee(
  choices: AssigneeChoices,
  trade: string,
): { key: string; earlier: Assignee | null } {
  const text = trade.trim();
  if (text === '') return { key: '', earlier: null };
  if (same(choices.homeowner.label, text)) return { key: choices.homeowner.key, earlier: null };
  const crew = choices.crew.find((c) => same(c.label, text));
  if (crew !== undefined) return { key: crew.key, earlier: null };
  return {
    key: EARLIER_KEY,
    earlier: { key: EARLIER_KEY, label: text, display: `${text} (entered earlier)`, kind: 'earlier' },
  };
}

export type ResolvedAssignee =
  | { kind: 'none' }
  | { kind: 'keep' }
  | { kind: 'person'; assignee: Assignee }
  | { kind: 'unknown' };

/** What a posted key means. Anything not offered to this contractor is refused. */
export function resolveAssignee(choices: AssigneeChoices, key: string): ResolvedAssignee {
  if (key === '') return { kind: 'none' };
  if (key === EARLIER_KEY) return { kind: 'keep' };
  if (key === choices.homeowner.key) return { kind: 'person', assignee: choices.homeowner };
  const crew = choices.crew.find((c) => c.key === key);
  return crew === undefined ? { kind: 'unknown' } : { kind: 'person', assignee: crew };
}

/**
 * Should saving this send the email?
 *
 * On a new appointment: whenever somebody is tagged. On an edit: only when the
 * tag CHANGES to somebody, so fixing a typo in the title does not email the crew
 * again every time.
 */
export function shouldNotify(previousTrade: string | null, next: ResolvedAssignee): boolean {
  if (next.kind !== 'person') return false;
  if (previousTrade === null) return true;
  return !same(previousTrade, next.assignee.label);
}

export type Audience = 'contractor' | 'crew' | 'homeowner';

export interface Recipient {
  email: string;
  name: string;
  audience: Audience;
}

/**
 * The contractor, and the tagged person — once each.
 *
 * A contractor who tags themself (their crew membership shares the address)
 * gets one email, the contractor's. Blank addresses are dropped rather than
 * sent to.
 */
export function appointmentRecipients(input: {
  contractor: { email: string | null; name: string };
  assignee: Assignee;
  assigneeEmail: string | null;
}): Recipient[] {
  const out: Recipient[] = [];
  const add = (email: string | null, name: string, audience: Audience) => {
    const normalized = (email ?? '').trim().toLowerCase();
    if (normalized === '' || !normalized.includes('@')) return;
    if (out.some((r) => r.email === normalized)) return;
    out.push({ email: normalized, name, audience });
  };
  add(input.contractor.email, input.contractor.name, 'contractor');
  add(
    input.assigneeEmail,
    input.assignee.kind === 'homeowner' ? input.assignee.label.replace(/^Homeowner — /, '') : input.assignee.label,
    input.assignee.kind === 'homeowner' ? 'homeowner' : 'crew',
  );
  return out;
}

/**
 * `trade` as a homeowner may read it.
 *
 * A crew member with no name is stored by email address. The homeowner sees
 * that someone from the crew is coming, not how to reach them directly.
 */
export function portalSafeTrade(trade: string): string {
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(trade) ? 'Field crew' : trade;
}

/**
 * `2026-09-22T09:00` as "Tue, Sep 22, 2026, 9:00 AM".
 *
 * The form's value has no time zone and neither does this: it is formatted as
 * written, in UTC, so a server in another zone cannot move the appointment.
 * Anything already carrying a zone is cut to the same wall-clock digits first.
 */
export function appointmentTimeLabel(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (match === null) return null;
  const [, y, mo, d, h, mi] = match;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)));
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

/** "Tue, Sep 22, 2026, 9:00 AM – 11:00 AM", or null when there is no start. */
export function appointmentWhen(startsAt: string | null, endsAt: string | null): string | null {
  const start = appointmentTimeLabel(startsAt);
  if (start === null) return null;
  const end = appointmentTimeLabel(endsAt);
  if (end === null) return start;
  const sameDay = (startsAt ?? '').slice(0, 10) === (endsAt ?? '').slice(0, 10);
  return sameDay ? `${start} – ${end.split(', ').pop()}` : `${start} – ${end}`;
}
