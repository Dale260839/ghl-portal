import Link from 'next/link';
import { notFound } from 'next/navigation';
import { INTERNAL_FIELD_DENY_LIST } from '@buildsuite/contracts';
import { updateVisibility } from '@/lib/actions';
import { getDataSource } from '@/lib/data/source';
import { requireTenantScope } from '@/lib/scope';
import { VISIBILITY_LABELS, VISIBILITY_SWITCHES } from '@/lib/data/mutations';
import { toClientProject } from '@/lib/client-view';
import { Badge, Card, CardHeader, currency } from '@/components/ui';

/**
 * Client Visibility Settings (§12.1) — the sixth and last Phase-3 screen.
 *
 * The switches on the left are clauses of the §9.1 gate. The panel on the right
 * is not a mock-up of their effect: it runs the **actual** gate and the actual
 * allow-list projection against this project and its real contact, and reports
 * what came back. Change a switch, save, and the panel changes because the
 * projection changed — not because a second copy of the rules agreed with the
 * first.
 */
export default async function VisibilitySettings({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = getDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  const contact = await db.getContact(project.primaryContactId);
  const projection = contact === null ? null : toClientProject(project, contact);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/dashboard/projects/${id}`}
          className="text-xs font-medium text-navy-400 hover:underline"
        >
          ← {project.projectName}
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-navy-900">
          Client Visibility Settings
        </h1>
        <p className="mt-1 text-sm text-navy-400">
          What {project.clientName} can see. Enforced at the data layer, not by hiding things on
          screen.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="Switches" />
          <form action={updateVisibility}>
            <input type="hidden" name="projectId" value={project.buildsuiteProjectId} />
            <ul className="divide-y divide-navy-100">
              {VISIBILITY_SWITCHES.map((key) => (
                <li key={key} className="px-5 py-3.5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      name={key}
                      defaultChecked={project[key]}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-navy-600"
                    />
                    <span>
                      <span className="block text-sm font-medium text-navy-900">
                        {VISIBILITY_LABELS[key].label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-navy-400">
                        {VISIBILITY_LABELS[key].help}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="border-t border-navy-100 px-5 py-4">
              <button
                type="submit"
                className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800"
              >
                Save visibility
              </button>
            </div>
          </form>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="What the client actually gets"
              action={
                <Link
                  href={`/portal?preview=${project.buildsuiteProjectId}`}
                  className="text-xs font-medium text-navy-600 hover:underline"
                >
                  Open their view →
                </Link>
              }
            />

            {contact === null ? (
              <p className="px-5 py-8 text-center text-sm text-navy-400">
                No contact is associated with this project, so nothing can be served (§9.1).
              </p>
            ) : projection !== null && !projection.allowed ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm font-medium text-navy-900">The client sees nothing.</p>
                <p className="mt-1.5 text-xs text-navy-400">
                  Gate denied: <code>{projection.reason}</code>
                </p>
              </div>
            ) : projection !== null ? (
              <dl className="divide-y divide-navy-100 text-sm">
                {[
                  ['Project name', projection.view.projectName],
                  ['Stage', projection.view.projectStage],
                  ['Progress', `${projection.view.progressPercentage}%`],
                  ['Current milestone', projection.view.currentMilestone],
                  [
                    'Estimated completion',
                    projection.view.estimatedCompletionDate ?? 'withheld',
                  ],
                  [
                    'Assigned team',
                    projection.view.team === null
                      ? 'withheld'
                      : `${projection.view.team.projectManager}, ${projection.view.team.superintendent}`,
                  ],
                  [
                    'Contract amount',
                    projection.view.budget === null
                      ? 'withheld'
                      : currency(projection.view.budget.contractAmount),
                  ],
                  [
                    'Remaining balance',
                    projection.view.budget === null
                      ? 'withheld'
                      : currency(projection.view.budget.remainingBalance),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 px-5 py-2.5">
                    <dt className="text-navy-600">{label}</dt>
                    <dd
                      className={
                        value === 'withheld'
                          ? 'text-xs font-medium tracking-wide text-navy-400 uppercase'
                          : 'font-medium text-navy-900'
                      }
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Never visible, whatever the switches say" />
            <div className="px-5 py-4">
              <div className="flex flex-wrap gap-1.5">
                {INTERNAL_FIELD_DENY_LIST.map((field) => (
                  <Badge key={field} tone="bad">
                    {field}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-navy-400">
                These are excluded from every client response by construction — the client view is
                built from an allow-list, so a field has to be deliberately added to reach a client.
                No combination of switches above can surface them.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
