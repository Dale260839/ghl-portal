import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubTeam } from '@/lib/hub-db/team';
import { Badge, Card, CardHeader, StatTile, shortDate } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';
import { getSession } from '@/lib/session';
import type { Task } from '@/lib/data/types';

/**
 * Tasks, across every project (Dale, 2026-09-24).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "Tasks" has been in the sidebar for weeks and opened **Active work** — the
 * book of jobs, a different screen about a different thing. A nav item that
 * lies is worse than one that is missing: somebody looking for the tasks they
 * assigned concluded the feature did not exist, when in fact it was one level
 * down inside each project.
 *
 * It answers the question a PM actually opens the app with: *what did I hand
 * out, and has anybody picked it up?* Per-project task lists cannot answer
 * that, because the answer spans projects.
 *
 * READ-ONLY, DELIBERATELY. Editing a task needs its project's context — the
 * crew on it, what may be released to the client — so every row links to the
 * project's own Tasks page, which already does all of that. A second place to
 * edit the same record is a second place for the rules to drift.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

const OPEN: Task['status'][] = ['Not Started', 'In Progress', 'Blocked', 'Ready for Review'];

function tone(status: string): 'neutral' | 'good' | 'warn' | 'bad' {
  if (status === 'Ready for Review') return 'good';
  if (status === 'In Progress') return 'warn';
  if (status === 'Blocked') return 'bad';
  return 'neutral';
}

export default async function AllTasks() {
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);

  const projectName = new Map(projects.map((p) => [p.buildsuiteProjectId, p.projectName] as const));

  // A session whose auth profile has no contractor record cannot read the Hub —
  // `assertContractor` throws, and seven of 64 profiles are in that state
  // through no fault of their own. Say so instead of producing a stack trace.
  if (scope.contractorId === undefined) {
    const session = await getSession();
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Tasks</h1>
        <NotLinkedToContractor what="Your tasks" email={session?.email} />
      </div>
    );
  }

  // Who a task is assigned to is stored as a membership id (§3.6 — never a
  // name). Resolve to people for display only; a task with an id we cannot
  // resolve still shows, as assigned to somebody no longer on the team.
  const team = getHubTeam();
  const members = team.available ? await team.team.listTeam(scope).catch(() => []) : [];
  const nameOf = new Map(members.map((m) => [m.id, m.fullName || m.email] as const));

  const open = tasks.filter((t) => OPEN.includes(t.status));
  const unopened = open.filter((t) => t.assignedTo !== null && t.seenAt === null);
  const review = tasks.filter((t) => t.status === 'Ready for Review');
  const unassigned = open.filter((t) => t.assignedTo === null);

  // Newest assignment first: the most recent thing handed out is the one most
  // likely to be asked about.
  const ordered = [...open].sort((a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open tasks" value={String(open.length)} />
        <StatTile label="Not opened yet" value={String(unopened.length)} />
        <StatTile label="Ready for review" value={String(review.length)} />
      </div>

      <Card>
        <CardHeader
          title="Open across every project"
          action={
            unassigned.length > 0 ? (
              <span className="text-xs text-navy-500">
                {unassigned.length} assigned to nobody
              </span>
            ) : undefined
          }
        />
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-navy-400">
            No open tasks. Assign one from a project&rsquo;s Tasks page.
          </p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {ordered.map((t) => (
              <li key={t.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/projects/${t.projectId}/tasks`}
                      className="font-medium text-navy-900 underline-offset-2 hover:underline"
                    >
                      {t.taskName}
                    </Link>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {projectName.get(t.projectId) ?? 'Project'}
                      {t.assignedTo !== null && (
                        <> · {nameOf.get(t.assignedTo) ?? 'someone no longer on the team'}</>
                      )}
                      {t.assignedTo === null && <> · unassigned</>}
                    </div>
                    {t.pmNote.trim() !== '' && (
                      <p className="mt-1 text-sm leading-relaxed text-navy-600">{t.pmNote}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {t.assignedTo !== null && t.seenAt === null && (
                      <Badge tone="warn">Not opened yet</Badge>
                    )}
                    <Badge tone={tone(t.status)}>{t.status}</Badge>
                    {t.scheduledDate !== '' && (
                      <span className="text-xs text-navy-400">{shortDate(t.scheduledDate)}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
