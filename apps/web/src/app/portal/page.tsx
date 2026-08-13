import Link from 'next/link';
import { getSession } from '@/lib/session';
import { getDataSource } from '@/lib/data/source';
import { scopeOfProject } from '@/lib/scope';
import { toClientMilestones, toClientProject, toClientUpdates } from '@/lib/client-view';
import { Badge, Card, CardHeader, ProgressBar, currency, shortDate } from '@/components/ui';
import type { Contact } from '@/lib/data/types';

/**
 * Client Portal. Every value on this page has passed through the §9.1 gate and
 * been projected onto an allow-listed DTO server-side (`client-view.ts`).
 * Internal notes, original estimate, markup, margin, and delay reasons are not
 * omitted by the template — they were never read.
 */
export default async function ClientPortal({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const session = await getSession();
  const params = await searchParams;
  const db = getDataSource();

  // Resolve the requesting contact. A client resolves it from their session —
  // never from the URL. A contractor previewing resolves it from the project.
  let contact: Contact | null = null;
  if (session?.role === 'client' && session.contactId !== undefined) {
    contact = await db.getContact(session.contactId);
  } else if (session?.role === 'contractor' && params.preview !== undefined) {
    const target = (await db.listProjects({ authProfileId: session.authProfileId ?? '', ghlLocationId: session.ghlLocationId }).catch(() => [])).find((p) => p.buildsuiteProjectId === params.preview) ?? null;
    contact = target === null ? null : await db.getContact(target.primaryContactId);
  }

  if (contact === null) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-navy-600">No projects are associated with this account.</p>
      </Card>
    );
  }

  // §1.4 — a contact may have many projects.
  const projects = await db.listProjectsForContact(contact.id);
  const selectedId = params.project ?? params.preview ?? projects[0]?.buildsuiteProjectId;
  const project = projects.find((p) => p.buildsuiteProjectId === selectedId) ?? projects[0];

  if (project === undefined) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm text-navy-600">No projects are associated with this account.</p>
      </Card>
    );
  }

  const gated = toClientProject(project, contact);
  if (!gated.allowed) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-sm font-medium text-navy-900">This project isn&apos;t available yet.</p>
        <p className="mt-1.5 text-xs text-navy-400">
          Your contractor hasn&apos;t enabled portal access for it.
        </p>
      </Card>
    );
  }

  const view = gated.view;
  const [allUpdates, allMilestones] = await Promise.all([
    db.listDailyUpdates(scopeOfProject(project), project.buildsuiteProjectId),
    db.listMilestones(scopeOfProject(project), project.buildsuiteProjectId),
  ]);
  const updates = toClientUpdates(allUpdates, project);
  const milestones = toClientMilestones(allMilestones, project);
  const upcoming = milestones.filter((m) => m.status !== 'Completed');

  return (
    <div className="space-y-6">
      {/* Project switcher — §12.3, multi-project clients */}
      {projects.length > 1 && (
        <nav className="flex flex-wrap gap-2">
          {projects.map((p) => {
            const active = p.buildsuiteProjectId === project.buildsuiteProjectId;
            return (
              <Link
                key={p.buildsuiteProjectId}
                href={`/portal?project=${p.buildsuiteProjectId}`}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'bg-navy-900 text-white'
                    : 'border border-navy-100 text-navy-600 hover:bg-navy-50'
                }`}
              >
                {p.projectName}
              </Link>
            );
          })}
        </nav>
      )}

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{view.projectName}</h1>
        <p className="mt-1 text-sm text-navy-400">{view.projectAddress}</p>
      </div>

      {view.clientActionRequired && (
        <div className="rounded-xl border border-amber-600/20 bg-amber-soft px-5 py-4">
          <div className="text-sm font-semibold text-amber-800">Your input is needed</div>
          <p className="mt-1 text-sm text-amber-700">
            There&apos;s an item waiting on your approval. Approvals and payments open in your
            secure portal account.
          </p>
          <button
            type="button"
            className="mt-3 rounded-lg bg-amber-accent px-3.5 py-2 text-sm font-semibold text-white"
          >
            Review and approve
          </button>
        </div>
      )}

      <Card className="px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs tracking-wide text-navy-400 uppercase">Current stage</div>
            <div className="mt-1 text-lg font-semibold text-navy-900">{view.projectStage}</div>
          </div>
          <Badge tone="accent">{view.currentMilestone}</Badge>
        </div>

        <div className="mt-5">
          <ProgressBar value={view.progressPercentage} label={false} />
          <div className="mt-2 flex justify-between text-xs text-navy-400">
            <span>{view.progressPercentage}% complete</span>
            {view.estimatedCompletionDate !== null && (
              <span>Estimated completion {shortDate(view.estimatedCompletionDate)}</span>
            )}
          </div>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-navy-100 pt-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs tracking-wide text-navy-400 uppercase">Up next</dt>
            <dd className="mt-1 text-sm font-medium text-navy-900">{view.nextMilestone}</dd>
          </div>
          <div>
            <dt className="text-xs tracking-wide text-navy-400 uppercase">Last updated</dt>
            <dd className="mt-1 text-sm font-medium text-navy-900">
              {shortDate(view.lastUpdatedDate)}
            </dd>
          </div>
          {view.team !== null && (
            <div>
              <dt className="text-xs tracking-wide text-navy-400 uppercase">Your team</dt>
              <dd className="mt-1 text-sm font-medium text-navy-900">
                {view.team.projectManager}
                <span className="block text-xs font-normal text-navy-400">
                  {view.team.superintendent}, site
                </span>
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming schedule" />
          <ol className="divide-y divide-navy-100">
            {upcoming.map((m) => (
              <li key={m.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-navy-900">{m.milestoneName}</span>
                  <Badge tone={m.status === 'In Progress' ? 'warn' : 'neutral'}>{m.status}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-navy-400">
                  {shortDate(m.plannedStart)} → {shortDate(m.plannedEnd)}
                </div>
              </li>
            ))}
            {upcoming.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-navy-400">
                Your contractor hasn&apos;t shared the schedule for this project.
              </li>
            )}
          </ol>
        </Card>

        {view.budget !== null ? (
          <Card>
            <CardHeader title="Budget summary" />
            <dl className="divide-y divide-navy-100 text-sm">
              {[
                ['Contract amount', currency(view.budget.contractAmount)],
                ['Approved changes', currency(view.budget.approvedChangeOrders)],
                ['Pending changes', currency(view.budget.pendingChangeOrders)],
                ['Project total', currency(view.budget.currentProjectTotal)],
                ['Paid to date', currency(view.budget.amountPaid)],
                ['Remaining balance', currency(view.budget.remainingBalance)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between px-5 py-2.5">
                  <dt className="text-navy-600">{label}</dt>
                  <dd className="tabular font-medium text-navy-900">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-navy-100 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-navy-400">Next payment due</div>
                  <div className="tabular text-sm font-semibold text-navy-900">
                    {currency(view.budget.nextPaymentAmount)} ·{' '}
                    {shortDate(view.budget.nextPaymentDueDate)}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white"
                >
                  Pay now
                </button>
              </div>
              <p className="mt-2.5 text-xs text-navy-400">
                Invoices and payments are handled in your secure GoHighLevel portal account.
              </p>
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader title="Budget summary" />
            <p className="px-5 py-8 text-center text-sm text-navy-400">
              Your contractor hasn&apos;t enabled budget visibility for this project.
            </p>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title="Recent updates" />
        <ul className="divide-y divide-navy-100">
          {updates.map((u) => (
            <li key={u.id} className="px-5 py-4">
              <div className="text-xs text-navy-400">{shortDate(u.updateDate)}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-navy-700">{u.clientSummary}</p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="rounded-md border border-navy-100 px-2.5 py-1 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
                >
                  Acknowledge
                </button>
                <button
                  type="button"
                  className="rounded-md border border-navy-100 px-2.5 py-1 text-xs font-medium text-navy-600 transition hover:bg-navy-50"
                >
                  Comment
                </button>
              </div>
            </li>
          ))}
          {updates.length === 0 && (
            <li className="px-5 py-8 text-center text-sm text-navy-400">
              No published updates yet. Your contractor reviews every field update before it
              appears here.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
