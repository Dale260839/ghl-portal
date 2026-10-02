import { SubmitButton } from '@/components/submit-button';
import { ContractorProjectRef } from '@/components/project-code';
import { projectById } from '@/lib/project-codes';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Card, shortDate } from '@/components/ui';
import { fieldProjectsFor } from '@/lib/field-scope';
import { requireAccess } from '@/lib/access';
import { sendFieldMessage } from '@/lib/actions';
import { getHubMessages } from '@/lib/hub-db/messages';
import { FieldConfirmation } from '@/components/field-nav';

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
  searchParams: Promise<{ sent?: string; project?: string }>;
}) {
  const { sent, project: chosen } = await searchParams;
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
    // ── NOT the fixture thread ────────────────────────────────────────────
    //
    // This used to fall back to `MESSAGES` — invented conversations between
    // invented people — whenever the Hub was unreachable. On 29 September the
    // BuildSuite key was revoked and screens went blank for an afternoon; had
    // this been that database, a crew member would have read fabricated
    // messages from their PM and answered them.
    //
    // Empty, and the screen says why. A blank list is a fact; a made-up
    // conversation is a lie with a timestamp on it.
    thread = [];
  }

  // The project itself, so the row can print its name AND its code. The old
  // `nameOf` fell back to the raw UUID when a project was not in the list;
  // <ContractorProjectRef> falls back to words instead.
  const projectOf = (projectId: string) => projectById(mine, projectId);

  // ── ONE PROJECT AT A TIME (Dale, 2026-10-02) ──────────────────────────────
  //
  // Every project's messages were merged into a single list. At two jobs that
  // reads as a conversation; at ten it is four people talking about four
  // different houses in one stream, and a crew member cannot follow any of
  // them. A message is about a job, so the job is how it is read.
  //
  // The chosen project comes from the URL and is checked against their OWN
  // assignments — never trusted from the query string — so a project id typed
  // by hand selects nothing rather than revealing anything.
  const selected =
    mine.find((p) => p.buildsuiteProjectId === chosen)?.buildsuiteProjectId ??
    mine[0]?.buildsuiteProjectId ??
    '';
  const visible = thread.filter((m) => m.projectId === selected);
  const unreadBy = (projectId: string) => thread.filter((m) => m.projectId === projectId).length;

  return (
    <div className="space-y-5">
      {sent === '1' && <FieldConfirmation>Sent to your project manager.</FieldConfirmation>}

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Messages</h1>
        <p className="mt-1 text-sm text-navy-400">
          {mine.length > 1 ? 'Pick a project to see its thread.' : 'The thread on your project.'}
        </p>
      </div>

      {mine.length > 1 && (
        // Scrolls sideways, like the bottom bar and for the same reason: at ten
        // projects these do not fit a phone, and shrinking them past a thumb is
        // worse than scrolling.
        <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {mine.map((p) => {
            const active = p.buildsuiteProjectId === selected;
            return (
              <li key={p.buildsuiteProjectId} className="shrink-0 snap-start">
                <a
                  href={`/field/messages?project=${encodeURIComponent(p.buildsuiteProjectId)}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium ${
                    active
                      ? 'border-navy-900 bg-navy-900 text-white'
                      : 'border-navy-200 bg-white text-navy-700'
                  }`}
                >
                  {p.projectName}
                  <span className={active ? 'text-navy-200' : 'text-navy-400'}>
                    {unreadBy(p.buildsuiteProjectId)}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}

      {visible.length === 0 ? (
        <Card className="px-4 py-8 text-center">
          <p className="text-sm text-navy-400">
            {hub.available
              ? 'No messages on this project yet. Ask your PM anything below.'
              : 'Messages are not available right now — nothing is missing from your projects, the app cannot reach them. Try again shortly.'}
          </p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((m) => (
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
              // The thread they are reading. Sending to a different project than
              // the one on screen is a mistake nobody means to make.
              defaultValue={selected}
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
