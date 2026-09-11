import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';

/**
 * Messages — the project conversation, as the Hub stores it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * `hub_messages` has been in the database since 0001 and nothing read or wrote
 * it. All three message screens rendered the same in-memory fixture array, so a
 * reply typed on one screen vanished on the next request and never reached the
 * other two. The contractor's compose box was a `<button type="button">` with
 * no handler at all.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS MODULE ENFORCES
 *
 * A message is INTERNAL until someone releases it. `client_visible` defaults to
 * false in the column and false here, so a note written on the contractor's
 * side reaches a homeowner only when a contractor decides it should. The one
 * exception runs the other way: a message the client wrote is always
 * client-visible, because a homeowner cannot be shown a portal thread that
 * hides their own words back from them.
 *
 * Field notes are never released. `post` will store whatever it is told, and
 * the field action is the only caller that passes `author_role: 'field'` — it
 * passes `clientVisible: false` with it, and the contractor screen offers no
 * release control for a field note.
 *
 * ---------------------------------------------------------------------------
 * WHO CAN REACH THIS
 *
 * Every method asserts the contractor, so a scope that cannot resolve one reads
 * nothing rather than everything. A homeowner holds no tenant scope of their
 * own; their reads come through `scopeOfProject`, built from a project they
 * were already authorized to see.
 * ---------------------------------------------------------------------------
 */

/** A message on a project, as the Hub stores it. */
export interface HubMessage {
  id: string;
  projectId: string;
  /** Display name of whoever wrote it. */
  author: string;
  /** 'contractor', 'field' or 'client'. Free text in the column, read as a tag. */
  authorRole: string;
  body: string;
  /** Whether this message is released to the homeowner. */
  clientVisible: boolean;
  createdAt: string;
}

interface MessageRow {
  id: string;
  project_id: string;
  author: string | null;
  author_role: string | null;
  body: string | null;
  client_visible: boolean | null;
  created_at: string;
}

function toMessage(row: MessageRow): HubMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    author: row.author ?? '',
    authorRole: row.author_role ?? '',
    body: row.body ?? '',
    clientVisible: row.client_visible === true,
    createdAt: row.created_at,
  };
}

export class HubMessages {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private tenant(scope: TenantScope, context: string): {
    filters: Record<string, string>;
    contractorId: string;
  } {
    const contractorId = assertContractor(scope, context);
    return { filters: { contractor_id: `eq.${contractorId}` }, contractorId };
  }

  /**
   * The live thread for a project, oldest first — a conversation reads down.
   *
   * Archived rows are excluded here rather than at each call site, so a new
   * screen cannot resurrect a message somebody removed.
   *
   * `clientVisibleOnly` is applied in the QUERY, not after it. A released-only
   * read that fetched everything and filtered in JavaScript would put internal
   * text one forgotten `.filter()` away from a homeowner's screen.
   */
  async listForProject(
    scope: TenantScope,
    projectId: string,
    opts: { clientVisibleOnly?: boolean } = {},
  ): Promise<HubMessage[]> {
    const { filters } = this.tenant(scope, 'messages');
    if (projectId.trim() === '') return [];

    const visibility: Record<string, string> =
      opts.clientVisibleOnly === true ? { client_visible: 'is.true' } : {};
    const rows = await this.client.select<MessageRow>({
      from: 'hub_messages',
      filters: {
        ...filters,
        ...visibility,
        project_id: `eq.${projectId}`,
        archived_at: 'is.null',
      },
      order: 'created_at.asc',
      limit: 500,
    });
    return rows.map(toMessage);
  }

  /**
   * Write a message.
   *
   * `clientVisible` defaults to false: internal unless the caller says
   * otherwise. A client's own message is forced to true — see the note at the
   * top of the file.
   */
  async post(
    scope: TenantScope,
    input: { projectId: string; body: string; clientVisible?: boolean },
    actor: { name: string; role: string },
  ): Promise<HubMessage> {
    const { contractorId } = this.tenant(scope, 'post a message');
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');
    // An empty message is a mis-click, and an empty bubble in a thread is worse
    // than a form that refuses to send.
    if (input.body.trim() === '') throw new TypeError('a message needs a body');

    const fromClient = actor.role === 'client';
    const [row] = await this.client.insert<MessageRow>({
      from: 'hub_messages',
      rows: [
        {
          project_id: input.projectId,
          contractor_id: contractorId,
          author: actor.name,
          author_role: actor.role,
          body: input.body.trim(),
          client_visible: fromClient ? true : (input.clientVisible ?? false),
        },
      ],
    });
    return toMessage(row!);
  }

  /**
   * Release a message to the homeowner, or take it back.
   *
   * Filtered on the asserted contractor as well as the id, so knowing an id is
   * not enough to publish something out of another contractor's thread.
   */
  async release(scope: TenantScope, messageId: string, clientVisible: boolean): Promise<void> {
    const { contractorId } = this.tenant(scope, 'release a message');
    if (messageId.trim() === '') throw new TypeError('messageId is required');

    await this.client.update({
      from: 'hub_messages',
      filters: { id: `eq.${messageId}`, contractor_id: `eq.${contractorId}` },
      patch: { client_visible: clientVisible },
    });
  }

  /**
   * Archive rather than delete. `HubClient` has no delete method at all, and
   * what was said on a project is a thing that happened.
   */
  async archive(scope: TenantScope, messageId: string): Promise<void> {
    const { contractorId } = this.tenant(scope, 'archive a message');
    if (messageId.trim() === '') throw new TypeError('messageId is required');

    await this.client.update({
      from: 'hub_messages',
      filters: {
        id: `eq.${messageId}`,
        contractor_id: `eq.${contractorId}`,
        archived_at: 'is.null',
      },
      patch: { archived_at: new Date().toISOString() },
    });
  }
}

export type HubMessagesResult =
  | { available: true; messages: HubMessages }
  | { available: false; missing: string[] };

export function getHubMessages(): HubMessagesResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, messages: new HubMessages(hub.client) };
}
