import { requireTenantScope } from '@/lib/scope';
import { getSession } from '@/lib/session';
import { getHubTeam, INVITABLE_ROLES, type Membership } from '@/lib/hub-db/team';
import { GRANTABLE_RESOURCES } from '@/lib/permissions';
import { inviteTeamMember, revokeTeamMember, restoreTeamMember, saveTeamGrants } from '@/lib/actions';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { NotLinkedToContractor } from '@/components/not-linked';

/**
 * Team — who the contractor has given access to, and to what.
 *
 * Two things this screen has to get right, and they pull in opposite
 * directions: it must be quick enough that a PM actually uses it, and it must
 * never let a tick box hand out something the role forbids.
 *
 * The second is solved in `permissions.ts` rather than here — `effectiveCan` is
 * role AND grant — so this screen can be plain without being dangerous. The
 * boxes it offers are only the resources a tick could genuinely affect
 * (`GRANTABLE_RESOURCES`); a control that cannot change anything is worse than
 * no control, because someone will believe it worked.
 */

/** Words a contractor would use, not resource names. */
const RESOURCE_LABELS: Record<string, string> = {
  milestone: 'Milestones',
  task: 'Tasks',
  dailyUpdate: 'Daily updates',
  document: 'Documents',
  photo: 'Photos',
  message: 'Messages',
  issue: 'Issues',
  selection: 'Selections',
  changeOrder: 'Change orders',
};

function statusOf(m: Membership): { label: string; tone: 'good' | 'warn' | 'neutral' | 'bad' } {
  if (m.revoked) return { label: 'Revoked', tone: 'bad' };
  if (!m.activated) return { label: 'Invited — not accepted', tone: 'warn' };
  return { label: 'Active', tone: 'good' };
}

export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; link?: string }>;
}) {
  const scope = await requireTenantScope();
  const session = await getSession();
  const params = await searchParams;
  const hub = getHubTeam();

  if (!hub.available) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Team</h1>
        <Card className="px-5 py-10 text-center">
          <p className="text-sm text-navy-600">The Hub database isn&apos;t connected.</p>
          <p className="mt-1.5 text-xs text-navy-400">Missing: {hub.missing.join(', ')}</p>
        </Card>
      </div>
    );
  }

  // The Hub files a team under `contractors.id`, and a session only knows an
  // auth profile id. Without the link there is nothing to read, and saying so
  // beats the 500 that `assertContractor` produces on its own.
  if (scope.contractorId === undefined) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Team</h1>
        <NotLinkedToContractor what="Your team" email={session?.email} />
      </div>
    );
  }

  const [members, grants] = await Promise.all([
    hub.team.listTeam(scope),
    hub.team.listGrants(scope),
  ]);

  const grantsFor = (id: string): Record<string, boolean> =>
    Object.fromEntries(
      grants.filter((g) => g.membershipId === id).map((g) => [g.resource, g.allowed]),
    );

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Team</h1>
        <p className="mt-1 text-sm text-navy-400">
          Invite your crew and your homeowners. Tick what each person can see.
        </p>
      </div>

      {/* The link is shown once, after inviting. No mail sender is configured
          yet, so the contractor sends it themselves — same link the email would
          carry, handed to the person allowed to send it. */}
      {params.link !== undefined && (
        <Card className="border-emerald-600/20 bg-emerald-50/50 px-5 py-4">
          <p className="text-sm font-medium text-emerald-800">
            Invitation created for {params.invited}
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            Send them this link. It works once and expires in 7 days.
          </p>
          <code className="mt-2 block overflow-x-auto rounded-lg border border-emerald-600/20 bg-white px-3 py-2 text-xs break-all text-navy-700">
            {params.link}
          </code>
        </Card>
      )}

      <Card>
        <CardHeader title="Invite someone" />
        <form action={inviteTeamMember} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <input
            name="email"
            type="email"
            required
            placeholder="their@email.com"
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm sm:col-span-2"
          />
          <input
            name="fullName"
            placeholder="Name (optional)"
            className="rounded-lg border border-navy-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              name="role"
              className="flex-1 rounded-lg border border-navy-200 px-3 py-2 text-sm"
              defaultValue="field"
            >
              {INVITABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role === 'field' ? 'Field crew' : 'Client'}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
            >
              Invite
            </button>
          </div>
        </form>
        <p className="border-t border-navy-100 px-5 py-3 text-xs text-navy-400">
          You can invite field crew and clients. Another contractor is an account-level change,
          not a team one.
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Who has access"
          action={<span className="text-xs text-navy-400">{members.length} people</span>}
        />
        <ul className="divide-y divide-navy-100">
          {members.map((member) => {
            const status = statusOf(member);
            const theirGrants = grantsFor(member.id);

            return (
              <li key={member.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-navy-900">
                        {member.fullName === '' ? member.email : member.fullName}
                      </span>
                      <Badge>{member.role === 'field' ? 'Field crew' : 'Client'}</Badge>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-navy-400">
                      {member.email}
                      {member.invitedBy !== null && ` · invited by ${member.invitedBy}`}
                      {member.activatedAt !== null &&
                        ` · joined ${shortDate(member.activatedAt.slice(0, 10))}`}
                    </div>
                  </div>

                  <form
                    action={member.revoked ? restoreTeamMember : revokeTeamMember}
                    className="shrink-0"
                  >
                    <input type="hidden" name="membershipId" value={member.id} />
                    <button
                      type="submit"
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                        member.revoked
                          ? 'border-navy-200 text-navy-700 hover:bg-navy-50'
                          : 'border-red-200 text-red-700 hover:bg-red-50'
                      }`}
                    >
                      {member.revoked ? 'Restore access' : 'Revoke'}
                    </button>
                  </form>
                </div>

                {!member.revoked && (
                  <form action={saveTeamGrants} className="mt-3">
                    <input type="hidden" name="membershipId" value={member.id} />
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {GRANTABLE_RESOURCES.map((resource) => (
                        <label
                          key={resource}
                          className="flex items-center gap-1.5 text-xs text-navy-600"
                        >
                          <input
                            type="checkbox"
                            name={resource}
                            defaultChecked={theirGrants[resource] !== false}
                            className="rounded border-navy-300"
                          />
                          {RESOURCE_LABELS[resource] ?? resource}
                        </label>
                      ))}
                      <button
                        type="submit"
                        className="rounded-lg border border-navy-200 px-3 py-1 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}

          {members.length === 0 && (
            <li className="px-5 py-12 text-center">
              <p className="text-sm text-navy-600">Nobody has been invited yet.</p>
              <p className="mt-1.5 text-xs text-navy-400">
                {session?.name ?? 'You'} can invite a superintendent to file updates from site,
                or a homeowner to follow their project.
              </p>
            </li>
          )}
        </ul>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        <strong className="font-semibold text-navy-600">What a tick can and cannot do.</strong>{' '}
        Unticking hides something from that person. Ticking never grants more than their role
        allows — a field user cannot be given budgets, and a homeowner cannot be given invoices,
        no matter what is ticked. The role is the ceiling and these boxes only lower it.
      </p>
    </div>
  );
}
