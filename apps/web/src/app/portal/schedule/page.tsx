import { currentPortalProject, scheduleFor } from '@/lib/portal-data';
import { Badge, Card, PortalEmpty } from '@/components/ui';

function dayParts(iso: string): { weekday: string; day: string; month: string } {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1));
  return {
    weekday: date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    day: String(date.getUTCDate()),
    month: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
  };
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

  const items = scheduleFor(project);

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
            const { weekday, day, month } = dayParts(item.scheduledDate);
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
                      <Badge tone={item.status === 'Confirmed' ? 'good' : item.status === 'Tentative' ? 'warn' : 'neutral'}>
                        {item.status}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-navy-400">
                      <span>{item.timeWindow}</span>
                      <span>{item.crew}</span>
                      <span>{item.location}</span>
                    </div>
                    {item.clientNote !== '' && (
                      <div className="mt-3 rounded-md bg-amber-soft px-3 py-2 text-sm text-amber-800">
                        {item.clientNote}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    {item.accessConfirmed ? (
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
