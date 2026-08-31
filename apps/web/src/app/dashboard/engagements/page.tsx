import Link from 'next/link';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getProposalsReader } from '@/lib/buildsuite/proposals';
import { resolveContractor } from '@/lib/buildsuite/contractor-identity';
import { getHubRecords } from '@/lib/hub-db/records';
import { buildEngagements, leadProjects, summarizeEngagements } from '@/lib/engagements';
import { Badge, Card, CardHeader, StatTile, currency } from '@/components/ui';

/**
 * Active work — the book of jobs, not the book of enquiries.
 *
 * This is the screen the product is actually for. The distinction it rests on:
 *
 *   a **lead** is an enquiry — somebody filled in a form
 *   an **engagement** is work — a contractor has proposed on it, for a price
 *
 * The Hub manages engagements. Leads stay reachable at the bottom because
 * deleting information is not our call, but they are not what a project manager
 * opens in the morning.
 *
 * It reads `proposals`, not `deals`. `deals` is 182 rows of which most are blank
 * or test entries and none records a signature; `proposals` carries the
 * contractor, the price and the signature state. The deal says who asked; the
 * proposal says who is doing it and whether they signed.
 */

const STAGE_TONE = {
  signed: 'good',
  accepted: 'accent',
  proposed: 'warn',
} as const;

const STAGE_LABEL = {
  signed: 'Signed',
  accepted: 'Accepted',
  proposed: 'Proposal out',
} as const;

export default async function Engagements() {
  const scope = await requireTenantScope();
  const reader = getProposalsReader();

  const projects = await (await currentDataSource(scope)).listProjects(scope);

  if (!reader.available) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Active work</h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">Not connected to BuildSuite.</p>
          <p className="mt-1.5 text-xs text-navy-400">Missing: {reader.missing.join(', ')}</p>
        </Card>
      </div>
    );
  }

  // Which contractor is this? `proposals` has no auth_profile_id, so without an
  // answer there is no tenant filter — and the honest response to "we do not
  // know whose work this is" is to show none of it, not all of it.
  const identity = await resolveContractor(scope);
  if (!identity.resolved) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Active work</h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">
            This sign-in isn&apos;t linked to a contractor record yet.
          </p>
          <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
            Proposals are filed against a contractor, so we need to know which one you are before
            showing any work. Rather than show you everyone&apos;s jobs, we show none. Linking is a
            one-off change on the BuildSuite side — setting <code>contractor_id</code> on your
            auth profile, or matching your sign-in email to your contractor record.
          </p>
        </Card>
      </div>
    );
  }

  const proposals = await reader.listLive(scope, identity.identity.contractorId, 200);
  const all = buildEngagements({ proposals, projects });

  // Archived jobs leave this list the same way they leave the projects list.
  const hub = getHubRecords();
  const overlays = hub.available
    ? await hub.records.getOverlays(scope, all.map((e) => e.projectId))
    : [];
  const archived = new Set(overlays.filter((o) => o.archivedAt !== null).map((o) => o.projectId));
  const engagements = all.filter((e) => !archived.has(e.projectId));

  const summary = summarizeEngagements(engagements);
  const leads = leadProjects(projects, all);

  return (
    <div className="space-y-7">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight text-navy-900">Active work</h1>
          <Badge tone="good">Live data</Badge>
        </div>
        <p className="mt-1 text-sm text-navy-400">
          Jobs a contractor has proposed on. Enquiries with no proposal are listed separately.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Engagements" value={String(summary.total)} />
        <StatTile
          label="Signed"
          value={String(summary.signed)}
          sub="contract in place"
          tone={summary.signed > 0 ? 'good' : 'default'}
        />
        <StatTile label="Awaiting decision" value={String(summary.proposed + summary.accepted)} />
        <StatTile
          label="Known value"
          value={summary.knownValue === 0 ? '—' : currency(summary.knownValue)}
          sub={
            summary.withoutAmount > 0
              ? `${summary.withoutAmount} without a figure`
              : 'across these jobs'
          }
        />
      </div>

      <Card>
        <CardHeader
          title="The book of work"
          action={<span className="text-xs text-navy-400">signed first</span>}
        />
        <ul className="divide-y divide-navy-100">
          {engagements.map((e) => (
            <li key={e.projectId} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {e.project === null ? (
                      <span className="truncate text-sm font-medium text-navy-500 italic">
                        {e.title}
                      </span>
                    ) : (
                      <Link
                        href={`/dashboard/projects/${e.projectId}`}
                        className="truncate text-sm font-medium text-navy-900 hover:underline"
                      >
                        {e.title}
                      </Link>
                    )}
                    <Badge tone={STAGE_TONE[e.stage]}>{STAGE_LABEL[e.stage]}</Badge>
                    {e.contractorId === null && <Badge tone="warn">No contractor</Badge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-400">
                    {e.clientName !== '' && <span>{e.clientName}</span>}
                    {e.proposal.timeline !== '' && <span>{e.proposal.timeline}</span>}
                    {e.proposalCount > 1 && <span>{e.proposalCount} proposals</span>}
                  </div>
                </div>
                <div className="tabular shrink-0 text-sm font-medium text-navy-900">
                  {e.proposal.amount === null
                    ? e.proposal.priceText === ''
                      ? '—'
                      : e.proposal.priceText
                    : currency(e.proposal.amount)}
                </div>
              </div>
            </li>
          ))}

          {engagements.length === 0 && (
            <li className="px-5 py-12 text-center">
              <p className="text-sm text-navy-600">No active work for this account yet.</p>
              <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-navy-400">
                A job appears here once a proposal is submitted with your company attached. If you
                expect work here and see none, the likely cause is that your sign-in is not yet
                linked to your contractor record in BuildSuite — a one-off fix on their side.
              </p>
            </li>
          )}
        </ul>
      </Card>

      {leads.length > 0 && (
        <Card>
          <CardHeader
            title="Enquiries"
            action={
              <span className="text-xs text-navy-400">{leads.length} with no proposal yet</span>
            }
          />
          <ul className="divide-y divide-navy-100">
            {leads.slice(0, 10).map((p) => (
              <li key={p.buildsuiteProjectId} className="flex items-center justify-between gap-3 px-5 py-3">
                <Link
                  href={`/dashboard/projects/${p.buildsuiteProjectId}`}
                  className="truncate text-sm text-navy-700 hover:underline"
                >
                  {p.projectName}
                </Link>
                <span className="shrink-0 text-xs text-navy-400">{p.clientName}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
            These have no proposal attached, so there is nothing to manage yet. They are kept
            here rather than hidden — a project you cannot find looks like a project the system
            lost.
          </p>
        </Card>
      )}

      <p className="text-xs text-navy-400">
        Showing work filed against your contractor record
        {identity.identity.via === 'email' && ', matched by your sign-in email'}.
      </p>

      {summary.unreadableProjects > 0 && (
        <p className="text-xs leading-relaxed text-navy-400">
          <strong className="font-semibold text-navy-600">
            {summary.unreadableProjects} of these has details we cannot read.
          </strong>{' '}
          BuildSuite&apos;s row-level security hides the project record from our key, so the
          proposal is visible but the name and address are not. The work is shown anyway —
          dropping it would hide a real job because of a permissions setting.
        </p>
      )}
    </div>
  );
}
