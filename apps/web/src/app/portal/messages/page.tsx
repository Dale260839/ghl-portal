import { currentPortalProject, messagesFor } from '@/lib/portal-data';
import { Card, PortalEmpty, shortDate } from '@/components/ui';

export default async function PortalMessages({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; preview?: string }>;
}) {
  const { project } = await currentPortalProject(await searchParams);
  if (project === null) {
    return <PortalEmpty title="No project" body="Nothing is shared with this account yet." />;
  }

  const messages = messagesFor(project);

  if (!project.allowClientMessaging) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Messages</h1>
        <PortalEmpty
          title="Messaging is switched off"
          body="Your contractor has turned off portal messaging for this project. Contact them directly."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="flex h-[calc(100dvh-16rem)] min-h-[28rem] flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-navy-100 px-5 py-3.5">
          <div>
            <div className="text-sm font-semibold text-navy-900">Project Team</div>
            <div className="text-xs text-navy-400">
              {project.projectManager} (PM){project.showAssignedTeam ? `, ${project.superintendent} (Site)` : ''}
            </div>
          </div>
          <button type="button" className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50">
            New Topic
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.length === 0 && (
            <p className="py-10 text-center text-sm text-navy-400">
              No messages yet. Send one and your project manager will see it.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.fromClient ? 'flex justify-end' : 'flex gap-3'}>
              {!m.fromClient && (
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-700">
                  {m.sender
                    .split(' ')
                    .map((n) => n[0])
                    .join('')}
                </div>
              )}
              <div className={m.fromClient ? 'max-w-[80%]' : 'max-w-[80%] min-w-0'}>
                <div className={`mb-1 flex items-center gap-2 text-xs text-navy-400 ${m.fromClient ? 'justify-end' : ''}`}>
                  <span className="font-medium text-navy-600">
                    {m.fromClient ? 'You' : m.sender}
                  </span>
                  <span>{shortDate(m.sentDate)}</span>
                </div>
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    m.fromClient ? 'bg-navy-900 text-white' : 'bg-navy-50 text-navy-700'
                  }`}
                >
                  {m.message}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2.5 border-t border-navy-100 px-5 py-4">
          <input
            type="text"
            placeholder="Type your message…"
            className="flex-1 rounded-lg border border-navy-200 px-3.5 py-2.5 text-sm focus:border-navy-600 focus:ring-1 focus:ring-navy-600 focus:outline-none"
          />
          <button type="button" className="rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy-800">
            Send
          </button>
        </div>
      </Card>

      <p className="text-xs text-navy-400">
        Messages here go to your project team. Internal team discussion is kept separate and is
        never shown in your portal.
      </p>
    </div>
  );
}
