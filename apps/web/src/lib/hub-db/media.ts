import 'server-only';

import { getHubClient, type HubClient } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';

/**
 * Documents and photos — the files hanging off a project.
 *
 * ---------------------------------------------------------------------------
 * ONE MODULE FOR BOTH, BECAUSE THEY ARE THE SAME THING
 *
 * `hub_documents` and `hub_photos` differ by two columns: a document has a
 * `title` and `category`, a photo has a `caption` and `taken_at`. Everything
 * that matters — the tenant column, the client-visible flag, the storage path,
 * the archive pair — is identical. Two modules would be the same rules written
 * twice, and the second copy is the one that drifts.
 *
 * Both tables have existed since migration 0001 and nothing has ever written
 * either. `storage.ts` could already put a FILE in the bucket; nothing wrote
 * the ROW that says which project it belongs to, so an uploaded file was
 * unreachable.
 *
 * ---------------------------------------------------------------------------
 * A FILE AND ITS ROW ARE NOT THE SAME THING
 *
 * `attach` writes the row only. The caller uploads first and passes the path,
 * because a failed upload must not leave a row pointing at nothing — a
 * document that lists but will not open reads as data loss.
 *
 * `externalUrl` is the alternative: a link to something not in our bucket.
 * Exactly one of the two is required, and a row with neither is refused.
 * ---------------------------------------------------------------------------
 */

export type MediaKind = 'document' | 'photo';

export interface MediaItem {
  id: string;
  projectId: string;
  kind: MediaKind;
  /** A document's title, or a photo's caption. Never blank on a document. */
  label: string;
  /** Documents only. */
  category: string;
  /** Path inside the `hub-media` bucket, when the file is ours. */
  storagePath: string | null;
  /** A link to something we do not host. */
  externalUrl: string | null;
  /** Photos only — when the picture was taken, not when it was uploaded. */
  takenAt: string | null;
  clientVisible: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

export const DOCUMENT_CATEGORIES = [
  'Contract',
  'Permit',
  'Drawing',
  'Warranty',
  'Invoice',
  'Other',
] as const;

interface MediaRow {
  id: string;
  project_id: string;
  title?: string | null;
  caption?: string | null;
  category?: string | null;
  storage_path: string | null;
  external_url: string | null;
  taken_at?: string | null;
  client_visible: boolean | null;
  uploaded_by: string | null;
  created_at: string;
}

const TABLE: Record<MediaKind, string> = {
  document: 'hub_documents',
  photo: 'hub_photos',
};

function toItem(row: MediaRow, kind: MediaKind): MediaItem {
  return {
    id: row.id,
    projectId: row.project_id,
    kind,
    label: (kind === 'document' ? row.title : row.caption) ?? '',
    category: row.category ?? '',
    storagePath: row.storage_path,
    externalUrl: row.external_url,
    takenAt: row.taken_at ?? null,
    clientVisible: row.client_visible === true,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export class HubMedia {
  private readonly client: HubClient;

  constructor(client: HubClient) {
    this.client = client;
  }

  private tenant(scope: TenantScope, context: string) {
    const contractorId = assertContractor(scope, context);
    return { filters: { contractor_id: `eq.${contractorId}` }, contractorId };
  }

  async listForProject(
    scope: TenantScope,
    kind: MediaKind,
    projectId: string,
  ): Promise<MediaItem[]> {
    const { filters } = this.tenant(scope, `${kind}s`);
    if (projectId.trim() === '') return [];

    const rows = await this.client.select<MediaRow>({
      from: TABLE[kind],
      filters: { ...filters, project_id: `eq.${projectId}`, archived_at: 'is.null' },
      order: 'created_at.desc',
      limit: 300,
    });
    return rows.map((row) => toItem(row, kind));
  }

  /**
   * Record a file against a project.
   *
   * Requires either a storage path or an external URL. A row with neither is a
   * listing entry that opens nothing, which is worse than a missing entry
   * because it looks like the file was lost.
   */
  async attach(
    scope: TenantScope,
    kind: MediaKind,
    input: {
      projectId: string;
      label: string;
      category?: string;
      storagePath?: string | null;
      externalUrl?: string | null;
      takenAt?: string | null;
      clientVisible?: boolean;
    },
    actor: { name: string },
  ): Promise<MediaItem> {
    const { contractorId } = this.tenant(scope, `attach ${kind}`);
    if (input.projectId.trim() === '') throw new TypeError('projectId is required');

    const label = input.label.trim();
    if (kind === 'document' && label === '') throw new TypeError('a document needs a title');

    const path = input.storagePath?.trim() || null;
    const url = input.externalUrl?.trim() || null;
    if (path === null && url === null) {
      throw new TypeError('a file needs either an uploaded path or a link');
    }
    if (url !== null && !/^https?:\/\//i.test(url)) {
      throw new TypeError('a link must be an http(s) URL');
    }

    const base = {
      project_id: input.projectId,
      contractor_id: contractorId,
      storage_path: path,
      external_url: url,
      // Off by default, like everything else a homeowner might see. A file is
      // the contractor's until they decide to release it.
      client_visible: input.clientVisible ?? false,
      uploaded_by: actor.name,
    };

    const row =
      kind === 'document'
        ? { ...base, title: label, category: input.category?.trim() || null }
        : { ...base, caption: label || null, taken_at: input.takenAt ?? null };

    const [created] = await this.client.insert<MediaRow>({ from: TABLE[kind], rows: [row] });
    return toItem(created!, kind);
  }

  /** Edit the label, category and release state. The file itself never moves. */
  async update(
    scope: TenantScope,
    kind: MediaKind,
    itemId: string,
    patch: { label?: string; category?: string; clientVisible?: boolean },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, `update ${kind}`);
    if (itemId.trim() === '') throw new TypeError('itemId is required');
    if (kind === 'document' && patch.label !== undefined && patch.label.trim() === '') {
      throw new TypeError('a document needs a title');
    }

    const values: Record<string, unknown> = {};
    if (patch.label !== undefined) {
      values[kind === 'document' ? 'title' : 'caption'] = patch.label.trim() || null;
    }
    if (patch.category !== undefined && kind === 'document') {
      values.category = patch.category.trim() || null;
    }
    if (patch.clientVisible !== undefined) values.client_visible = patch.clientVisible;
    if (Object.keys(values).length === 0) return;

    await this.client.update({
      from: TABLE[kind],
      filters: { id: `eq.${itemId}`, contractor_id: `eq.${contractorId}` },
      patch: values,
    });
  }

  /**
   * Archive the row. **The file in the bucket is left alone.**
   *
   * Deliberate: `HubClient` has no delete method, and removing the object would
   * break any signed URL already in a homeowner's hands. A retention rule can
   * sweep the bucket later, when one exists.
   */
  async archive(
    scope: TenantScope,
    kind: MediaKind,
    itemId: string,
    actor: { name: string },
  ): Promise<void> {
    const { contractorId } = this.tenant(scope, `archive ${kind}`);
    if (itemId.trim() === '') throw new TypeError('itemId is required');

    await this.client.update({
      from: TABLE[kind],
      filters: {
        id: `eq.${itemId}`,
        contractor_id: `eq.${contractorId}`,
        archived_at: 'is.null',
      },
      patch: { archived_at: new Date().toISOString(), archived_by: actor.name },
    });
  }
}

export type HubMediaResult =
  | { available: true; media: HubMedia }
  | { available: false; missing: string[] };

export function getHubMedia(): HubMediaResult {
  const hub = getHubClient();
  if (!hub.available) return { available: false, missing: hub.missing };
  return { available: true, media: new HubMedia(hub.client) };
}
