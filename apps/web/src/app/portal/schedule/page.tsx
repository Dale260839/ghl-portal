import { currentPortalProject, scheduleFor } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty } from '@/components/ui';

/**
 * The calendar block for an appointment.
 *
 * `startsAt` is a full timestamp from the Hub ("2026-09-11T09:00:00+00:00"),
 * not a bare date. The first version split it on "-" and fed "11T09:00:00+00:00"
 * to `Date.UTC`, which produced an Invalid Date, and `toLocaleDateString` on an
 * Invalid Date throws. That took the whole client schedule page down the
 * moment a contractor released their first appointment (10 Sep). An unparseable
 * or missing start now renders a "TBC" block instead of an error page.
 */
function dayParts(iso: string | null): { weekday: string; day: string; month: string } {
  if (iso === null || iso.trim() === '') return { weekday: 'Date', day: 'TBC', month: '' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { weekday: 'Date', day: 'TBC', month: '' };
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
    day: String(date.getDate()),
    month: date.toLocaleDateString('en-US', { month: 'short' }),
  };
}

/** "8:00 AM – 12:00 PM", or just the start when there is no end. */
function timeWindow(startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null) return 'Date to be confirmed';
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const start = new Date(startsAt).toLocaleTimeString('en-US', opts);
  if (endsAt === null) return start;
  return `${start} – ${new Date(endsAt).toLocaleTimeString('en-US', opts)}`;
}

export default async function PortalSchedule({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const items = await scheduleFor(project);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Project Schedule</h1>
          <p className="mt-1 text-sm text-navy-400">Upcoming work dates and appointments.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50">
            Request Change
          </button>
          <button type="button" className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800">
            Sync Calendar
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-navy-100 bg-navy-50/60 px-5 py-3.5">
        <div className="text-sm font-medium text-navy-900">Schedule notice</div>
        <p className="mt-0.5 text-sm text-navy-600">
          Dates can move for weather, inspections, material availability, or site conditions. We
          will tell you about anything significant.
        </p>
      </div>

      {items.length === 0 ? (
        <PortalEmpty
          title="Schedule not shared"
          body="Your contractor hasn't published the schedule for this project yet."
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const { weekday, day, month } = dayParts(item.startsAt);
            return (
              <Card key={item.id} className="p-5">
                <div className="flex flex-wrap items-start gap-5">
                  <div className="w-20 shrink-0 rounded-lg bg-navy-50 px-3 py-2.5 text-center">
                    <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">
                      {weekday.slice(0, 3)}
                    </div>
                    <div className="tabular text-2xl font-semibold text-navy-900">{day}</div>
                    <div className="text-xs text-navy-400">{month}</div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-base font-medium text-navy-900">{item.title}</span>
                      <Badge
                        tone={
                          item.status === 'Complete'
                            ? 'good'
                            : item.status === 'In Progress'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-400">
                      <span>{timeWindow(item.startsAt, item.endsAt)}</span>
                      {item.trade !== '' && <span>{item.trade}</span>}
                    </div>
                  </div>

                  <div className="hidden shrink-0 flex-col gap-2">
                    {false ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-700">
                        Access confirmed
                      </span>
                    ) : (
                      <button type="button" className="rounded-lg border border-navy-200 px-3.5 py-2 text-sm font-medium text-navy-700 transition hover:bg-navy-50">
                        Confirm Access
                      </button>
                    )}
                    <button type="button" className="text-sm font-medium text-navy-600 hover:underline">
                      Ask Question
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
