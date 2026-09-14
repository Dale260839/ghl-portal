import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getBuildSuiteReader } from '@/lib/buildsuite/projects';
import { resolveContractorName } from '@/lib/buildsuite/contractor-identity';
import { getHubTeam, type Membership } from '@/lib/hub-db/team';
import { clientCode } from '@/lib/project-codes';
import {
  addMemberToProject,
  inviteToProject,
  removeMemberFromProject,
  resetMemberPassword,
  restoreTeamMember,
  revokeTeamMember,
} from '@/lib/actions';
import { SubmitButton } from '@/components/submit-button';
import { NotLinkedToContractor } from '@/components/not-linked';
import { ControlHeader, ControlNote } from '@/components/control';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';

/**
 * People — who is on THIS project, and how each of them gets in.
 *
 * John, 2026-09-15: the client's email, a resettable password, the field
 * workers, and the invitation — here, per project, not on the global Team
 * screen. "Invitation is per project."
 *
 * ---------------------------------------------------------------------------
 * THE HOMEOWNER'S PASSWORD IS NOT RESETTABLE HERE, AND THE SCREEN SAYS WHY
 *
 * A homeowner signs in with the email on their contract and their PROJECT CODE
 * as the password (Chris, 2026-09-10). That code is BuildSuite's
 * `projects.project_code`, which the Hub can never write, and it is also the
 * project's permanent identity — changing it would re-label the job everywhere.
 * So a homeowner has no Hub password to reset. What the contractor CAN do is
 * shown: the code to read them, and Revoke / Restore.
 *
 * Field workers set their own password from an invitation, so theirs IS
 * resettable: a single-use link, emailed when sending is on and shown here
 * either way.
 * ---------------------------------------------------------------------------
 */

function crewStatus(m: Membership): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (m.revoked) return { label: 'Access revoked', tone: 'bad' };
  if (!m.activated) return { label: 'Invited — not accepted yet', tone: 'warn' };
  return { label: 'Active', tone: 'good' };
}

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

const DELIVERY: Record<string, string> = {
  sent: 'Emailed through GoHighLevel. The link is below too, in case they need it again.',
  disabled: 'Email sending is off, so send them this link yourself.',
  failed: 'The email did not send. Send them this link yourself.',
  none: 'Send them this link.',
};

export default async function ProjectPeople({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    kind?: string;
    who?: string;
    link?: string;
    delivery?: string;
    added?: string;
    notice?: string;
  }>;
}) {
  const { id } = await params;
  const flash = await searchParams;
  const scope = await requireTenantScope();
  const project = await (await currentDataSource(scope)).getProject(scope, id);
  if (project === null) notFound();

  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="People" />;
  }

  const buildsuite = getBuildSuiteReader();
  const clientEmail = buildsuite.available
    ? await buildsuite.clientEmailForProject(scope, id).catch(() => null)
    : null;
  const companyName = (await resolveContractorName(scope)) ?? '';

  const hub = getHubTeam();
  let onProject: Membership[] = [];
  let everyone: Membership[] = [];
  let teamProblem: string | null = null;
  if (!hub.available) {
    teamProblem = `The Hub database is not connected (missing ${hub.missing.join(', ')}), so the crew cannot be listed or invited.`;
  } else {
    try {
      [onProject, everyone] = await Promise.all([
        hub.team.listForProject(scope, id),
        hub.team.listTeam(scope),
      ]);
    } catch {
      teamProblem = 'The crew could not be read just now. Try again in a moment.';
    }
  }

  const homeowner = onProject.find((m) => m.role === 'client') ?? null;
  const crew = onProject.filter((m) => m.role === 'field');
  const crewIds = new Set(crew.map((m) => m.id));
  const addable = everyone.filter((m) => m.role === 'field' && !m.revoked && !crewIds.has(m.id));
  const code = clientCode(project);

  return (
    <div className="space-y-6">
      <ControlHeader
        title="People"
        subtitle="Who is on this project, how each of them signs in, and inviting someone to it."
      />

      {/* What just happened, once. The link is shown whether or not the email
          went: if sending is off the contractor needs it, and if it went they
          can still see what the person received. */}
      {flash.link !== undefined && (
        <Card className="border-emerald-600/20 bg-emerald-50/50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">
            {flash.kind === 'reset' ? `Password reset link for ${flash.who}` : `Invitation for ${flash.who}`}
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            {DELIVERY[flash.delivery ?? 'none'] ?? DELIVERY.none}{' '}
            {flash.kind === 'reset'
              ? 'It works once and expires in 24 hours. Their current password keeps working until they choose a new one.'
              : 'It works once and expires in 7 days.'}
          </p>
          <code className="mt-2 block overflow-x-auto rounded-lg border border-emerald-600/20 bg-white px-3 py-2 text-xs break-all text-navy-700">
            {flash.link}
          </code>
        </Card>
      )}
      {flash.added !== undefined && (
        <ControlNote>
          {flash.added} was already on your team, so they have been added to this project — no new
          invitation needed. They see it the next time they open the Hub.
        </ControlNote>
      )}
      {flash.notice !== undefined && <ControlNote>{flash.notice}</ControlNote>}

      {/* ── The homeowner ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Homeowner" />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Name</div>
            <div className="mt-1 text-sm text-navy-900">{project.clientName || 'Not on the contract'}</div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Email — their sign-in</div>
            <div className="mt-1 text-sm text-navy-900">
              {clientEmail ?? <span className="text-navy-400">No email on the contract — they cannot sign in</span>}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Password</div>
            <div className="mt-1 text-sm text-navy-900">
              {code === null ? (
                <span className="text-navy-400">No project code yet — they cannot sign in until it has one</span>
              ) : (
                <>
                  Their project code, <span className="font-semibold tracking-wide">{code}</span>
                </>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium tracking-wide text-navy-400 uppercase">Status</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-navy-900">
              {homeowner === null ? (
                <span className="text-navy-500">Has not signed in yet</span>
              ) : homeowner.revoked ? (
                <Badge tone="bad">Access revoked</Badge>
              ) : (
                <>
                  <Badge tone="good">Signed in</Badge>
                  {homeowner.lastSeenAt !== null && (
                    <span className="text-xs text-navy-400">last seen {shortDate(homeowner.lastSeenAt.slice(0, 10))}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-navy-100 px-5 py-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-navy-400">
            A homeowner&apos;s password is their project code from the signed contract, so it
            can&apos;t be reset here — the code is BuildSuite&apos;s and is also this project&apos;s
            identity. If they have lost it, read it to them. To lock them out, revoke access.
          </p>
          {homeowner !== null && (
            <form action={homeowner.revoked ? restoreTeamMember : revokeTeamMember}>
              <input type="hidden" name="membershipId" value={homeowner.id} />
              <SubmitButton tone={homeowner.revoked ? 'secondary' : 'danger'}>
                {homeowner.revoked ? 'Restore access' : 'Revoke access'}
              </SubmitButton>
            </form>
          )}
        </div>
      </Card>

      {/* ── The crew on THIS project ─────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Field crew on this project"
          action={<span className="text-xs text-navy-400">{crew.length} {crew.length === 1 ? 'person' : 'people'}</span>}
        />
        {teamProblem !== null ? (
          <p className="px-5 py-4 text-sm text-navy-500">{teamProblem}</p>
        ) : crew.length === 0 ? (
          <p className="px-5 py-4 text-sm text-navy-500">
            Nobody from your crew is on this project yet. Invite someone below.
          </p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {crew.map((m) => {
              const status = crewStatus(m);
              return (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-900">{m.fullName || m.email}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {m.email}
                      {m.lastSeenAt !== null && ` · last seen ${shortDate(m.lastSeenAt.slice(0, 10))}`}
                      {m.projectIds.length > 1 && ` · on ${m.projectIds.length} projects`}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!m.revoked && (
                      <form action={resetMemberPassword}>
                        <input type="hidden" name="projectId" value={id} />
                        <input type="hidden" name="membershipId" value={m.id} />
                        <input type="hidden" name="companyName" value={companyName} />
                        <SubmitButton tone="secondary">
                          {m.activated ? 'Reset password' : 'Send a new invitation link'}
                        </SubmitButton>
                      </form>
                    )}
                    <form action={removeMemberFromProject}>
                      <input type="hidden" name="projectId" value={id} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <SubmitButton tone="secondary">Remove from project</SubmitButton>
                    </form>
                    <form action={m.revoked ? restoreTeamMember : revokeTeamMember}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <SubmitButton tone={m.revoked ? 'secondary' : 'danger'}>
                        {m.revoked ? 'Restore access' : 'Revoke'}
                      </SubmitButton>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
          Remove takes someone off this project only. Revoke locks them out of every project.
        </p>
      </Card>

      {/* ── Invite, to THIS project ──────────────────────────────────── */}
      {teamProblem === null && (
        <Card>
          <CardHeader title="Invite someone to this project" />
          <form action={inviteToProject} className="grid gap-3 px-5 py-4 sm:grid-cols-[1fr_1fr_auto]">
            <input type="hidden" name="projectId" value={id} />
            <input type="hidden" name="companyName" value={companyName} />
            <input name="email" type="email" required placeholder="their@email.com" className={FIELD} />
            <input name="fullName" placeholder="Name (optional)" className={FIELD} />
            <SubmitButton>Invite to project</SubmitButton>
          </form>
          <p className="px-5 pb-3 text-xs text-navy-400">
            Field crew only. They set their own password from the link. Somebody already on your team
            is added to this project instead of being invited again. Homeowners are never invited —
            they sign in with their project code.
          </p>

          {addable.length > 0 && (
            <form
              action={addMemberToProject}
              className="flex flex-wrap items-center gap-3 border-t border-navy-100 px-5 py-4"
            >
              <input type="hidden" name="projectId" value={id} />
              <label className="text-sm text-navy-700" htmlFor="add-existing">
                Or add someone already on your team:
              </label>
              <select id="add-existing" name="membershipId" required className={FIELD}>
                {addable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName ? `${m.fullName} — ${m.email}` : m.email}
                  </option>
                ))}
              </select>
              <SubmitButton tone="secondary">Add to project</SubmitButton>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
