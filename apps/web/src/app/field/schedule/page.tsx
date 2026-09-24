import { requireAccess } from '@/lib/access';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { fieldProjectsFor } from '@/lib/field-scope';
import { getHubSchedule, type ScheduleItem } from '@/lib/hub-db/schedule';
import { appointmentsForField, splitByTime, type FieldAppointment } from '@/lib/field-schedule';
import { Badge, Card, CardHeader } from '@/components/ui';

/**
 * The crew's schedule (Dale, 2026-09-24).
 *
 * A contractor could tag an appointment to a crew member and email them about
 * it, and the crew member had nowhere in the app to see it. The email was the
 * whole of their access to their own schedule.
 *
 * Access is by project, the same rule as every other field screen; the "You"
 * badge is by label and decides nothing. See `field-schedule.ts` for why those
 * two are deliberately different mechanisms.
 *
 * It shows `notes` — which are internal, and a crew member is internal. The
 * homeowner's copy of this data goes through `portalSafeTrade` and a different
 * screen entirely.
 */

export const dynamic = 'force-dynamic';

function whenLabel(item: ScheduleItem): string {
  if (item.startsAt === null) return 'Date to be confirmed';
  const start = new Date(item.startsAt);
  if (Number.isNaN(start.getTime())) return 'Date to be confirmed';

  const date = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function Appointment({ item, project }: { item: FieldAppointment; project: string }) {
  return (
    <li className={`px-4 py-3.5 ${item.mine ? 'bg-amber-soft/40' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-navy-900">{item.title}</span>
            {item.mine && <Badge tone="warn">You</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-navy-400">{project}</div>
          {item.trade.trim() !== '' && !item.mine && (
            <div className="mt-0.5 text-xs text-navy-400">For {item.trade}</div>
          )}
          {item.notes.trim() !== '' && (
            <p className="mt-1.5 text-sm leading-relaxed text-navy-600">{item.notes}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-medium text-navy-900">{whenLabel(item)}</div>
          <div className="mt-0.5 text-xs text-navy-400">{item.status}</div>
        </div>
      </div>
    </li>
  );
}

export default async function FieldSchedule() {
  const access = await requireAccess();
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);

  const assigned = fieldProjectsFor(access, projects, tasks);
  const assignedIds = new Set(assigned.map((p) => p.buildsuiteProjectId));
  const nameOf = new Map(assigned.map((p) => [p.buildsuiteProjectId, p.projectName] as const));

  // One read per assigned project. A crew member has a handful, and the schedule
  // store has no "many projects" read — inventing one for this screen would put
  // a query shape in the tenancy path for a list of two.
  const hub = getHubSchedule();
  const items: ScheduleItem[] = hub.available
    ? (
        await Promise.all(
          [...assignedIds].map((id) =>
            hub.schedule.listForProject(scope, id).catch(() => [] as ScheduleItem[]),
          ),
        )
      ).flat()
    : [];

  const { upcoming, past } = splitByTime(
    appointmentsForField(items, assignedIds, {
      name: access.session.name,
      email: access.session.email,
    }),
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Upcoming" />
        {upcoming.length === 0 ? (
          <p className="px-4 py-6 text-sm text-navy-400">
            {hub.available
              ? 'Nothing scheduled on your projects yet. Your PM adds appointments here.'
              : 'The schedule is not available right now. Try again shortly.'}
          </p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {upcoming.map((item) => (
              <Appointment
                key={item.id}
                item={item}
                project={nameOf.get(item.projectId) ?? 'Your project'}
              />
            ))}
          </ul>
        )}
      </Card>

      {past.length > 0 && (
        <Card>
          <CardHeader title="Past" />
          <ul className="divide-y divide-navy-100">
            {past.slice(0, 20).map((item) => (
              <Appointment
                key={item.id}
                item={item}
                project={nameOf.get(item.projectId) ?? 'Your project'}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
