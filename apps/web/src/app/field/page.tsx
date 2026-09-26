import { FieldTaskActions } from '@/components/field-task-actions';
import { ownsTask } from '@/lib/permissions';

import { requireTenantScope } from '@/lib/scope';
import { requireAccess } from '@/lib/access';
import { fieldProjectsFor } from '@/lib/field-scope';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { stageLabel } from '@/lib/data/types';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubSchedule, type ScheduleItem } from '@/lib/hub-db/schedule';
import { appointmentsForField, splitByTime } from '@/lib/field-schedule';
import { ClearFieldDraft } from '@/components/field-draft';

/**
 * Field Interface (§12.2). Mobile-first, large tap targets, minimal typing.
 *
 * The rule this screen exists to enforce: the update form ends in TWO separate
 * text areas — Internal Field Notes and Suggested Client Progress Summary — and
 * there is no publish button anywhere on it. Submitting sends the update to the
 * PM (WF3) and notifies nobody else.
 */
export default async function FieldToday({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; pm?: string }>;
}) {
  const { submitted, pm } = await searchParams;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);

  // §12.2 / §9.4 — a field user sees only assigned projects.
  //
  // This filtered on `superintendent === 'Tony Alvarez'`: a fixture author's
  // name, hardcoded, in the screen every crew member lands on. Every real user
  // saw an empty Today list, and the §3.6 violation was invisible because the
  // demo account happened to be Tony.
  const access = await requireAccess();
  const assigned = fieldProjectsFor(access, projects, tasks);
  const assignedIds = new Set(assigned.map((p) => p.buildsuiteProjectId));
  const todaysTasks = tasks.filter((t) => assignedIds.has(t.projectId));

  // What is coming up on their projects. On Today rather than only behind the
  // Schedule tab, because a crew member opens this screen to find out where
  // they are meant to be — and until 2026-09-24 the answer only existed in an
  // email their PM may or may not have sent.
  const hub = getHubSchedule();
  const scheduleItems: ScheduleItem[] = hub.available
    ? (
        await Promise.all(
          [...assignedIds].map((id) =>
            hub.schedule.listForProject(scope, id).catch(() => [] as ScheduleItem[]),
          ),
        )
      ).flat()
    : [];
  const { upcoming } = splitByTime(
    appointmentsForField(scheduleItems, assignedIds, {
      name: access.session.name,
      email: access.session.email,
    }),
  );
  const nextUp = upcoming.slice(0, 3);

  return (
    <div className="space-y-5">
      {/* The draft goes only when the update is actually filed. This screen is
          where `submitFieldUpdate` lands on success, which is the first moment
          it is safe to throw away what they wrote. */}
      {submitted === '1' && <ClearFieldDraft />}

      {submitted === '1' && (
        <div className="rounded-lg border border-emerald-600/20 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Update submitted to your project manager for review.{' '}
          {/* Whether anyone was actually told. "Saved" and "they know" are
              different facts, and the crew deserve the true one. */}
          {pm === 'sent'
            ? 'They have been emailed.'
            : 'Nobody was emailed — tell them if it is urgent.'}
        </div>
      )}

      {nextUp.length > 0 && (
        <Card>
          <CardHeader
            title="Coming up"
            action={
              <a href="/field/schedule" className="text-xs font-medium text-navy-600 underline">
                See all
              </a>
            }
          />
          <ul className="divide-y divide-navy-100">
            {nextUp.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy-900">{item.title}</span>
                    {item.mine && <Badge tone="warn">You</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-navy-400">
                    {projects.find((p) => p.buildsuiteProjectId === item.projectId)?.projectName ??
                      'Your project'}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-navy-400">
                  {item.startsAt === null ? 'Date TBC' : shortDate(item.startsAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Today's tasks" />
        <ul className="divide-y divide-navy-100">
          {todaysTasks.map((t) => {
            const project = projects.find((p) => p.buildsuiteProjectId === t.projectId);
            return (
              <li key={t.id} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-navy-900">{t.taskName}</div>
                    <div className="mt-0.5 truncate text-xs text-navy-400">
                      {project?.projectName} · {t.assignedTrade}
                    </div>
                  </div>
                  <Badge
                    tone={
                      t.status === 'In Progress'
                        ? 'warn'
                        : t.status === 'Ready for Review'
                          ? 'good'
                          : 'neutral'
                    }
                  >
                    {t.status}
                  </Badge>
                </div>
                {access.can('update', 'task') && ownsTask(access.session, t) && (
                  <FieldTaskActions taskId={t.id} />
                )}
              </li>
            );
          })}
          {todaysTasks.length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-navy-400">Nothing scheduled today.</li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHeader title="My projects" />
        <ul className="divide-y divide-navy-100">
          {assigned.map((p) => (
            <li key={p.buildsuiteProjectId} className="px-4 py-3">
              <div className="text-sm font-medium text-navy-900">{p.projectName}</div>
              <div className="mt-0.5 text-xs text-navy-400">
                {stageLabel(p)} · updated {shortDate(p.lastUpdatedDate)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
