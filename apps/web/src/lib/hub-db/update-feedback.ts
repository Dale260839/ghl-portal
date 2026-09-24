import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { columnSupport } from './column-support.ts';

/**
 * Acknowledgements and comments on a published update (Dale, 2026-09-24).
 *
 * Both tables have existed since 0001 and nothing has ever read or written
 * them. A homeowner could read what their contractor published and had no way
 * to say "got it" or "what about the tiles?", and a PM who published an update
 * had no idea whether anyone ever opened it.
 *
 * ---------------------------------------------------------------------------
 * HOW TENANCY WORKS HERE, BECAUSE IT IS NOT THE USUAL WAY
 *
 * Every other table in this folder carries `contractor_id`, and every method
 * filters on it. **These two do not have that column.** They carry `update_id`
 * and `project_id` and nothing else that identifies an owner.
 *
 * So the boundary is enforced one level up, and the rule is absolute: **a
 * caller passes only update ids it has already read through a tenant-scoped
 * read.** `hub_daily_updates` does carry `contractor_id`, so an update id in
 * hand is proof of ownership; a `project_id` taken from a form is not proof of
 * anything.
 *
 * That is why there is no `listForProject(projectId)` here, tempting as it
 * would be. It would accept an id from anywhere and answer with somebody
 * else's conversation.
 *
 * WHAT `client_visible` MEANS ON A COMMENT
 *
 * Whether the homeowner may see it — the same meaning it has everywhere else.
 * A homeowner's own comment is written `true`, because they wrote it and hiding
 * it from them would be absurd. A contractor's reply is `true` only when they
 * choose to reply to the client rather than note something internally.
 * ---------------------------------------------------------------------------
 */

const ACKS = 'hub_update_acknowledgements';
const COMMENTS = 'hub_update_comments';

export interface UpdateAcknowledgement {
  id: string;
  updateId: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

export interface UpdateComment {
  id: string;
  updateId: string;
  author: string;
  authorRole: string;
  body: string;
  clientVisible: boolean;
  createdAt: string;
}

interface AckRow {
  id: string;
  update_id: string;
  acknowledged_by: string;
  acknowledged_at: string;
}

interface CommentRow {
  id: string;
  update_id: string;
  author: string;
  author_role: string;
  body: string;
  client_visible: boolean;
  created_at: string;
  archived_at: string | null;
}

/** PostgREST `in.(a,b,c)`. Empty lists never reach the database. */
function inList(ids: readonly string[]): string {
  return `in.(${ids.join(',')})`;
}

export class HubUpdateFeedback {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private available(): Promise<boolean> {
    return columnSupport(this.client, COMMENTS, ['update_id']);
  }

  /**
   * Everything said about these updates.
   *
   * `updateIds` must come from a tenant-scoped read — see the note above. An
   * empty list returns empty without a request, which also means a project with
   * no updates costs nothing.
   */
  async forUpdates(
    updateIds: readonly string[],
  ): Promise<{ acknowledgements: UpdateAcknowledgement[]; comments: UpdateComment[] }> {
    const ids = updateIds.filter((id) => id.trim() !== '');
    if (ids.length === 0) return { acknowledgements: [], comments: [] };
    if (!(await this.available())) return { acknowledgements: [], comments: [] };

    const [ackRows, commentRows] = await Promise.all([
      this.client
        .select<AckRow>({ from: ACKS, filters: { update_id: inList(ids) }, limit: 500 })
        .catch(() => [] as AckRow[]),
      this.client
        .select<CommentRow>({
          from: COMMENTS,
          filters: { update_id: inList(ids), archived_at: 'is.null' },
          order: 'created_at.asc',
          limit: 500,
        })
        .catch(() => [] as CommentRow[]),
    ]);

    return {
      acknowledgements: ackRows.map((r) => ({
        id: r.id,
        updateId: r.update_id,
        acknowledgedBy: r.acknowledged_by,
        acknowledgedAt: r.acknowledged_at,
      })),
      comments: commentRows.map((r) => ({
        id: r.id,
        updateId: r.update_id,
        author: r.author,
        authorRole: r.author_role,
        body: r.body,
        clientVisible: r.client_visible,
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * "Got it."
   *
   * Idempotent by person: acknowledging twice does not write a second row, so
   * a double tap on a phone — or a page reload — cannot turn one homeowner into
   * two. The check is a read rather than a constraint because the table has no
   * unique index and adding one to a live table is a migration for a button.
   */
  async acknowledge(input: {
    updateId: string;
    projectId: string;
    by: string;
  }): Promise<boolean> {
    if (!(await this.available())) return false;

    const existing = await this.client
      .select<AckRow>({
        from: ACKS,
        filters: { update_id: `eq.${input.updateId}`, acknowledged_by: `eq.${input.by}` },
        limit: 1,
      })
      .catch(() => [] as AckRow[]);
    if (existing.length > 0) return true;

    await this.client.insert({
      from: ACKS,
      rows: [
        {
          update_id: input.updateId,
          project_id: input.projectId,
          acknowledged_by: input.by,
        },
      ],
    });
    return true;
  }

  /** A reply. Empty bodies are refused before they reach the database. */
  async comment(input: {
    updateId: string;
    projectId: string;
    author: string;
    authorRole: string;
    body: string;
    clientVisible: boolean;
  }): Promise<boolean> {
    const body = input.body.trim();
    if (body === '') return false;
    if (!(await this.available())) return false;

    await this.client.insert({
      from: COMMENTS,
      rows: [
        {
          update_id: input.updateId,
          project_id: input.projectId,
          author: input.author,
          author_role: input.authorRole,
          body,
          client_visible: input.clientVisible,
        },
      ],
    });
    return true;
  }
}

export type HubUpdateFeedbackResult =
  | { available: true; feedback: HubUpdateFeedback }
  | { available: false; missing: string[] };

export function getHubUpdateFeedback(): HubUpdateFeedbackResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, feedback: new HubUpdateFeedback(hub.client) };
}
