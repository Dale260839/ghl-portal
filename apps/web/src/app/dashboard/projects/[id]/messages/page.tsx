import { notFound } from 'next/navigation';

import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { MESSAGES } from '@/lib/data/portal-fixtures';
import { Card, shortDate } from '@/components/ui';
import { ControlEmpty, ControlHeader, ControlNote } from '@/components/control';

/**
 * Messages — contractor control side. The same thread the client sees, from the
 * contractor's seat. Chris's model: conversations run through GoHighLevel, back
 * and forth, recorded, and shown on both sides — so the transcript here is the
 * transcript there.
 */
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

  const messages = MESSAGES.filter((m) => m.projectId === id).sort((a, b) =>
    a.sentDate.localeCompare(b.sentDate),
  );
  const messagingOn = project.clientPortalEnabled && project.allowClientMessaging;

  return (
    <div className="space-y-6">
      <ControlHeader
        title="Messages"
        subtitle="The client conversation, from your side. Recorded through GoHighLevel."
        clientHref={`/portal/messages?preview=${id}`}
      />

      <ControlNote>
        {messagingOn ? (
          <>Client messaging is on. Replies here reach the homeowner and stay on the record.</>
        ) : (
          <>
            Client messaging is <strong className="font-semibold text-navy-900">off</strong> for
            this project. Turn it on under Visibility to let the homeowner write back.
          </>
        )}
      </ControlNote>

      {messages.length === 0 ? (
        <ControlEmpty title="No messages" body="The conversation with this client will appear here." />
      ) : (
        <Card className="px-5 py-5">
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.fromClient ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                    m.fromClient ? 'bg-navy-50 text-navy-800' : 'bg-navy-900 text-white'
                  }`}
                >
                  <div
                    className={`text-xs font-medium ${m.fromClient ? 'text-navy-500' : 'text-navy-100'}`}
                  >
                    {m.sender} · {m.senderRole}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed">{m.message}</p>
                  <div
                    className={`mt-1 text-right text-[11px] ${m.fromClient ? 'text-navy-400' : 'text-navy-300'}`}
                  >
                    {shortDate(m.sentDate)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-2 border-t border-navy-100 pt-4">
            <input
              type="text"
              placeholder="Write a reply…"
              className="min-w-0 flex-1 rounded-lg border border-navy-200 px-3.5 py-2 text-sm text-navy-900 placeholder:text-navy-400 focus:border-navy-400 focus:outline-none"
            />
            <button
              type="button"
              className="rounded-lg bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-navy-800"
            >
              Send
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
