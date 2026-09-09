import { SubmitButton } from '@/components/submit-button';
import { NotLinkedToContractor } from '@/components/not-linked';
import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubSchedule, SCHEDULE_STATUSES, type ScheduleItem } from '@/lib/hub-db/schedule';
import { archiveScheduleItem, createScheduleItem, updateScheduleItem } from '@/lib/actions';
import { Badge, Card, CardHeader } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Schedule — the contractor's control side, and now a real one.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED
 *
 * This screen used to list `SCHEDULE_ITEMS` from a fixture file and offer a
 * "New appointment" button that was a `<button type="button">` with no handler.
 * It looked finished and did nothing. It now reads and writes
 * `hub_schedule_items`, which has existed since migration 0001 and had never
 * been touched.
 *
 * ---------------------------------------------------------------------------
 * WHO CAN DO THIS
 *
 * Contractors only, three times over: `/dashboard` redirects any session that
 * is not a contractor, every action calls `assertCan(..., 'schedule')`, and
 * every query filters on the asserted contractor id. A field member cannot
 * reach this page, and could not write through it if they did.
 *
 * A homeowner never sees this screen. They see the schedule in the portal, and
 * only the appointments released to them — `clientVisible` on the row AND
 * "Show Schedule to Client" on the project. Both are shown here so a contractor
 * can tell at a glance what the client is actually looking at.
 * ---------------------------------------------------------------------------
 */

function dateTimeValue(iso: string | null): string {
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone or seconds.
  if (iso === null) return '';
  const at = iso.length >= 16 ? iso.slice(0, 16) : '';
  return at.includes('T') ? at : '';
}

function whenLabel(item: ScheduleItem): string {
  if (item.startsAt === null) return 'No date set';
  const start = new Date(item.startsAt);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (item.endsAt === null) return start.toLocaleString('en-US', opts);

  const end = new Date(item.endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  const endLabel = end.toLocaleString('en-US',
    sameDay ? { hour: 'numeric', minute: '2-digit' } : opts,
  );
  return `${start.toLocaleString('en-US', opts)} – ${endLabel}`;
}

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

export default async function ProjectScheduleControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  // Nine of the sixty-eight accounts on this location do not resolve to a
  // contractor record, and everything the Hub stores is filed under one. Say
  // so rather than throwing: `assertContractor` is right to refuse, but a
  // TenancyError on screen tells the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="The schedule" />;
  }

  const hub = getHubSchedule();
  const items = hub.available ? await hub.schedule.listForProject(scope, id) : [];
  const scheduleReleased = project.clientPortalEnabled && project.showScheduleToClient;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Schedule"
        subtitle="Set and publish the work dates. The client sees the schedule but cannot change it."
        clientHref={`/portal/schedule?preview=${id}`}
      />

      {!hub.available ? (
        <ControlNote>
          The Hub database is not connected, so appointments cannot be read or saved. Missing:{' '}
          {hub.missing.join(', ')}.
        </ControlNote>
      ) : (
        <ControlNote>
          {scheduleReleased ? (
            <>
              The schedule is <strong className="font-semibold text-navy-900">published</strong> to
              this client. Individual appointments still follow their own client-visible flag.
            </>
          ) : (
            <>
              The schedule is <strong className="font-semibold text-navy-900">not published</strong>{' '}
              to this client. Turn on &ldquo;Show Schedule to Client&rdquo; under Visibility to
              release it.
            </>
          )}
        </ControlNote>
      )}

      {hub.available && (
        <Card>
          <CardHeader title="New appointment" />
          <form action={createScheduleItem} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
            <input type="hidden" name="projectId" value={id} />
            <input
              name="title"
              required
              placeholder="What is happening, e.g. Framing inspection"
              className={`${FIELD} sm:col-span-2`}
            />
            <input name="trade" placeholder="Trade or crew (optional)" className={FIELD} />
            <select name="status" defaultValue="Scheduled" className={FIELD}>
              {SCHEDULE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <label className="text-xs text-navy-500 sm:col-span-2">
              Starts
              <input type="datetime-local" name="startsAt" className={`${FIELD} mt-1 w-full`} />
            </label>
            <label className="text-xs text-navy-500 sm:col-span-2">
              Ends
              <input type="datetime-local" name="endsAt" className={`${FIELD} mt-1 w-full`} />
            </label>

            <textarea
              name="notes"
              rows={2}
              placeholder="Notes for your team"
              className={`${FIELD} sm:col-span-4`}
            />

            <div className="flex items-center justify-between gap-3 sm:col-span-4">
              {/* Not released on creation, and it says so rather than offering a
                  checkbox that would publish a date nobody had confirmed. */}
              <p className="text-xs text-navy-400">
                Saved as internal. Release it to the client with the switch on the appointment.
              </p>
              <SubmitButton
                className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
              >
                Add appointment
              </SubmitButton>
            </div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <ControlEmpty
          title="Nothing scheduled"
          body="Add the first appointment for this project."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">{item.title}</span>
                <Badge
                  tone={
                    item.status === 'Complete'
                      ? 'good'
                      : item.status === 'Cancelled'
                        ? 'bad'
                        : item.status === 'In Progress'
                          ? 'warn'
                          : 'neutral'
                  }
                >
                  {item.status}
                </Badge>
                {/* Both halves of the answer: the row's own flag AND the
                    project switch. An appointment marked visible on a project
                    whose schedule is not published reaches nobody. */}
                <VisibilityTag shown={scheduleReleased && item.clientVisible} />
                <span className="ml-auto text-xs text-navy-400">{whenLabel(item)}</span>
              </div>

              <form action={updateScheduleItem} className="mt-3 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="projectId" value={id} />
                <input
                  name="title"
                  defaultValue={item.title}
                  required
                  className={`${FIELD} sm:col-span-2`}
                />
                <input
                  name="trade"
                  defaultValue={item.trade}
                  placeholder="Trade or crew"
                  className={FIELD}
                />
                <select name="status" defaultValue={item.status} className={FIELD}>
                  {SCHEDULE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>

                <input
                  type="datetime-local"
                  name="startsAt"
                  defaultValue={dateTimeValue(item.startsAt)}
                  className={`${FIELD} sm:col-span-2`}
                />
                <input
                  type="datetime-local"
                  name="endsAt"
                  defaultValue={dateTimeValue(item.endsAt)}
                  className={`${FIELD} sm:col-span-2`}
                />

                <textarea
                  name="notes"
                  defaultValue={item.notes}
                  rows={2}
                  placeholder="Notes for your team"
                  className={`${FIELD} sm:col-span-4`}
                />

                <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
                  <label className="flex items-center gap-2 text-xs text-navy-600">
                    <input
                      type="checkbox"
                      name="clientVisible"
                      defaultChecked={item.clientVisible}
                      className="rounded border-navy-300"
                    />
                    Show this appointment to the client
                  </label>
                  <SubmitButton
                    className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                  >
                    Save
                  </SubmitButton>
                  <span className="ml-auto text-xs text-navy-300">
                    added by {item.createdBy ?? 'unknown'}
                  </span>
                </div>
              </form>

              {/* Archive, never delete. A cancelled appointment is a thing that
                  happened, and `HubClient` has no delete method at all. */}
              <form action={archiveScheduleItem} className="mt-2 border-t border-navy-100 pt-2">
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="projectId" value={id} />
                <SubmitButton
                  className="text-xs font-medium text-red-700 transition hover:underline"
                >
                  Remove from schedule
                </SubmitButton>
              </form>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
