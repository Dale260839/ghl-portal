import { SubmitButton } from '@/components/submit-button';
import { ContractorProjectRef } from '@/components/project-code';
import { projectById } from '@/lib/project-codes';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Card, shortDate } from '@/components/ui';
import { fieldMessages } from '@/lib/field-data';
import { fieldProjectsFor } from '@/lib/field-scope';
import { requireAccess } from '@/lib/access';
import { sendFieldMessage } from '@/lib/actions';
import { getHubMessages } from '@/lib/hub-db/messages';
import { FieldConfirmation } from '@/components/field-nav';
import { MESSAGES } from '@/lib/data/portal-fixtures';

/**
 * Field ↔ PM conversation (D2 Step 3, D4 §5).
 *
 * The crew can message their PM, ask a question about a task, and ask for
 * clarification. What they see back is the thread on the projects they are
 * actually on, and nothing from a project they are not — §9.4's "unassigned
 * projects" clause is what `fieldProjectsFor` is for.
 *
 * The thread now comes from `hub_messages` where the Hub is connected, so a
 * note typed here survives the request and lands on the contractor's Messages
 * tab for that project. Without a Hub it falls back to the fixture thread,
 * which is what every message screen used to read.
 */

/** One shape for both sources, so the list below does not branch. */
interface FieldThreadItem {
  id: string;
  projectId: string;
  sender: string;
  body: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

export default async function FieldMessages({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  // Tasks decide which projects are this person's, so both are needed.
  const [projects, tasks] = await Promise.all([db.listProjects(scope), db.listTasks(scope)]);
  const mine = fieldProjectsFor(await requireAccess(), projects, tasks);
  const mineIds = mine.map((p) => p.buildsuiteProjectId);

  const hub = getHubMessages();
  let thread: FieldThreadItem[];

  if (hub.available && scope.contractorId !== undefined) {
    const perProject = await Promise.all(
      mineIds.map((projectId) => hub.messages.listForProject(scope, projectId)),
    );
    thread = perProject
      .flat()
      // The crew's thread is the company's side of the conversation. What the
      // homeowner wrote is between them and the contractor (D2, §9.4), so a
      // client-authored message is not shown here, released or not.
      .filter((m) => m.authorRole !== 'client')
      .map((m) => ({
        id: m.id,
        projectId: m.projectId,
        sender: m.author === '' ? 'Unknown' : m.author,
        body: m.body,
        date: m.createdAt.slice(0, 10),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  } else {
    thread = fieldMessages(MESSAGES, new Set(mineIds)).map((m) => ({
      id: m.id,
      projectId: m.projectId,
      sender: m.sender,
      body: m.message,
      date: m.sentDate,
    }));
  }

  // The project itself, so the row can print its name AND its code. The old
  // `nameOf` fell back to the raw UUID when a project was not in the list;
  // <ContractorProjectRef> falls back to words instead.
  const projectOf = (projectId: string) => projectById(mine, projectId);

  return (
    <div className="space-y-5">
      {sent === '1' && <FieldConfirmation>Sent to your project manager.</FieldConfirmation>}

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Messages</h1>
        <p className="mt-1 text-sm text-navy-400">The thread on your projects.</p>
      </div>

      {thread.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">No messages yet. Ask your PM anything below.</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {thread.map((m) => (
            <li key={m.id}>
              <Card className="px-4 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold text-navy-900">{m.sender}</span>
                  <span className="text-xs text-navy-400">{shortDate(m.date)}</span>
                </div>
                <div className="mt-0.5 text-xs text-navy-400"><ContractorProjectRef project={projectOf(m.projectId)} /></div>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-navy-700">
                  {m.body}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="px-4 py-4">
        <form action={sendFieldMessage} className="space-y-3">
          <div>
            <label htmlFor="projectId" className="text-xs font-medium text-navy-600">
              Project
            </label>
            <select
              id="projectId"
              name="projectId"
              required
              className="mt-1.5 min-h-12 w-full rounded-lg border border-navy-200 bg-white px-3 text-sm"
            >
              {mine.map((p) => (
                <option key={p.buildsuiteProjectId} value={p.buildsuiteProjectId}>
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="body" className="text-xs font-medium text-navy-600">
              Message your PM
            </label>
            <textarea
              id="body"
              name="body"
              rows={3}
              required
              placeholder="Ask a question, flag a delay, request a decision…"
              className="mt-1.5 w-full rounded-lg border border-navy-200 px-3 py-2.5 text-sm"
            />
          </div>

          <SubmitButton
            className="min-h-12 w-full rounded-lg bg-navy-900 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Send to PM
          </SubmitButton>
        </form>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        What you write here goes to your project manager. They decide what, if anything, is passed
        on to the homeowner.
      </p>
    </div>
  );
}
