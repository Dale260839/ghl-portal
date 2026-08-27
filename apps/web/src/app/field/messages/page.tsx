import { getSession } from '@/lib/session';
import { requireTenantScope } from '@/lib/scope';
import { currentDataSource } from '@/lib/data/current-source';
import { Card, shortDate } from '@/components/ui';
import { fieldMessages, projectsForField } from '@/lib/field-data';
import { sendFieldMessage } from '@/lib/actions';
import { FieldConfirmation } from '@/components/field-nav';
import { MESSAGES } from '@/lib/data/portal-fixtures';

/**
 * Field ↔ PM conversation (D2 Step 3, D4 §5).
 *
 * The crew can message their PM, ask a question about a task, and ask for
 * clarification. What they cannot see is the homeowner's thread.
 *
 * D2 is explicit: *"Do not expose unrelated client or financial
 * communication."* `fieldMessages` drops anything client-visible and anything
 * the client wrote, so this screen is internal in both directions. A crew member
 * reading what a homeowner said about them is how a job goes wrong.
 */
export default async function FieldMessages({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;
  const session = await getSession();
  const scope = await requireTenantScope();
  const db = await currentDataSource(scope);

  const projects = await db.listProjects(scope);
  const mine = projectsForField(projects, session?.name ?? '');
  const mineIds = new Set(mine.map((p) => p.buildsuiteProjectId));
  const thread = fieldMessages(MESSAGES, mineIds);

  const nameOf = (projectId: string) =>
    mine.find((p) => p.buildsuiteProjectId === projectId)?.projectName ?? projectId;

  return (
    <div className="space-y-5">
      {sent === '1' && <FieldConfirmation>Sent to your project manager.</FieldConfirmation>}

      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Messages</h1>
        <p className="mt-1 text-sm text-navy-400">Your project manager, not the client.</p>
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
                  <span className="text-xs text-navy-400">{shortDate(m.sentDate)}</span>
                </div>
                <div className="mt-0.5 text-xs text-navy-400">{nameOf(m.projectId)}</div>
                <p className="mt-2 text-sm leading-relaxed text-navy-700">{m.message}</p>
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

          <button
            type="submit"
            className="min-h-12 w-full rounded-lg bg-navy-900 text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Send to PM
          </button>
        </form>
      </Card>

      <p className="text-xs leading-relaxed text-navy-400">
        This thread is internal. The homeowner never sees it, and you never see theirs.
      </p>
    </div>
  );
}
