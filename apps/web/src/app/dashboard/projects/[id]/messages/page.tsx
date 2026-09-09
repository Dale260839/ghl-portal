import { notFound } from 'next/navigation';

import { SubmitButton } from '@/components/submit-button';
import { NotLinkedToContractor } from '@/components/not-linked';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { getHubMessages, type HubMessage } from '@/lib/hub-db/messages';
import {
  archiveMessage,
  postProjectMessage,
  setMessageVisibility,
} from '@/lib/actions/messages';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote, VisibilityTag } from '@/components/control';

/**
 * Messages — the contractor's control side, and now a real one.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED
 *
 * This screen listed a fixture array and offered a reply box that was a
 * `<button type="button">` with no handler. It looked finished and did nothing.
 * It now reads and writes `hub_messages`, which has existed since migration
 * 0001 and had never been touched.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CONTRACTOR SEES HERE THAT NOBODY ELSE DOES
 *
 * Everything. The thread carries three kinds of message — the contractor's own,
 * the crew's, and the homeowner's — and this is the only screen that shows all
 * three together. That is what makes it a control centre rather than a second
 * copy of the portal, and it is why the release state is on every row.
 *
 * A message is internal until it is released. A field note is never released:
 * the crew writes to their PM, not to the customer, so those rows carry no
 * release control at all.
 * ---------------------------------------------------------------------------
 */

const ROLE_LABEL: Record<string, string> = {
  contractor: 'You',
  field: 'Crew',
  client: 'Client',
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? (role === '' ? 'Unknown' : role);
}

function roleTone(role: string): 'good' | 'warn' | 'neutral' {
  if (role === 'client') return 'good';
  if (role === 'field') return 'warn';
  return 'neutral';
}

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

export default async function ProjectMessagesControl({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);
  const project = await db.getProject(scope, id);
  if (project === null) notFound();

  // Some accounts on this location do not resolve to a contractor record, and
  // everything the Hub stores is filed under one. Say so rather than throwing:
  // `assertContractor` is right to refuse, but a TenancyError on screen tells
  // the person nothing they can act on.
  if (scope.contractorId === undefined) {
    return <NotLinkedToContractor what="Messages" />;
  }

  const hub = getHubMessages();
  const thread: HubMessage[] = hub.available
    ? await hub.messages.listForProject(scope, id)
    : [];

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Messages"
        subtitle="The project conversation, from your side. You see every message, the client sees only what you release."
        clientHref={`/portal/messages?preview=${id}`}
      />

      {!hub.available ? (
        <ControlNote>
          The Hub database is not connected, so messages cannot be read or saved. Missing:{' '}
          {hub.missing.join(', ')}.
        </ControlNote>
      ) : (
        <ControlNote>
          {project.clientPortalEnabled ? (
            <>
              This client&rsquo;s portal is{' '}
              <strong className="font-semibold text-navy-900">open</strong>, so anything you
              release here reaches them and they can write back.
            </>
          ) : (
            <>
              This client&rsquo;s portal is{' '}
              <strong className="font-semibold text-navy-900">closed</strong>. Released messages
              stay marked as released but reach nobody until you turn the portal on under
              Visibility.
            </>
          )}
        </ControlNote>
      )}

      {thread.length === 0 ? (
        <ControlEmpty
          title="No messages"
          body="Nothing has been said on this project yet. Start below."
        />
      ) : (
        <div className="space-y-3">
          {thread.map((message) => (
            <Card key={message.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-navy-900">
                  {message.author === '' ? 'Unknown' : message.author}
                </span>
                <Badge tone={roleTone(message.authorRole)}>{roleLabel(message.authorRole)}</Badge>
                <VisibilityTag shown={message.clientVisible} />
                <span className="ml-auto text-xs text-navy-400">
                  {shortDate(message.createdAt.slice(0, 10))}
                </span>
              </div>

              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-navy-700">
                {message.body}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-navy-100 pt-3">
                {message.authorRole === 'field' ? (
                  // The crew writes to their PM, never to the customer. There is
                  // no control here because there is no decision to make.
                  <span className="text-xs text-navy-400">
                    A field note. These are never released to the client.
                  </span>
                ) : (
                  <form action={setMessageVisibility}>
                    <input type="hidden" name="messageId" value={message.id} />
                    <input type="hidden" name="projectId" value={id} />
                    {!message.clientVisible && <input type="hidden" name="release" value="on" />}
                    <SubmitButton className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
                      {message.clientVisible ? 'Withdraw from client' : 'Release to client'}
                    </SubmitButton>
                  </form>
                )}

                {/* Archive, never delete. What was said on a project is a thing
                    that happened, and `HubClient` has no delete method at all. */}
                <form action={archiveMessage} className="ml-auto">
                  <input type="hidden" name="messageId" value={message.id} />
                  <input type="hidden" name="projectId" value={id} />
                  <SubmitButton className="text-xs font-medium text-red-700 transition hover:underline">
                    Remove
                  </SubmitButton>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hub.available && (
        <Card>
          <CardHeader title="Write a message" />
          <form action={postProjectMessage} className="space-y-3 px-5 py-4">
            <input type="hidden" name="projectId" value={id} />
            <textarea
              name="body"
              rows={3}
              required
              placeholder="Write to your team, or to the client if you release it."
              className={`${FIELD} w-full`}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-navy-600">
                <input type="checkbox" name="release" className="rounded border-navy-300" />
                Release to client
              </label>
              <SubmitButton className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700">
                Post message
              </SubmitButton>
            </div>
            <p className="text-xs text-navy-400">
              Internal unless you release it. Field notes are never released.
            </p>
          </form>
        </Card>
      )}
    </div>
  );
}
