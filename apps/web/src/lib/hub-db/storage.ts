import 'server-only';

import { readHubConfig } from './client.ts';
import { assertContractor, type TenantScope } from '../tenancy.ts';

/**
 * Photos and documents, in the Hub's own Supabase Storage.
 *
 * Chris settled this on 2026-09-01: Supabase rather than GoHighLevel media.
 * Beyond it being tidier, there is a rule that decides it — **the field crew
 * never touches GoHighLevel** (D4 §5). A crew member photographing a job has to
 * be able to upload it, and if the file lived in GHL media that upload would
 * pass through a system they are never allowed to see.
 *
 * ---------------------------------------------------------------------------
 * THE BUCKET IS PRIVATE AND EVERY LINK EXPIRES
 *
 * A public bucket hands out permanent URLs and calls them safe because they are
 * unguessable. Unguessable is not a permission: a link that leaks stays valid
 * for ever and cannot be revoked.
 *
 * So the bucket is private and files are served through **signed URLs minted
 * per request**, after the caller has already been allowed to see the record
 * that references them. The privacy gate decides whether a homeowner may see a
 * document; this makes the file obey that same answer rather than relying on
 * nobody sharing the link.
 * ---------------------------------------------------------------------------
 */

export const BUCKET = 'hub-media';

/** Ten minutes. Long enough to open a PDF, short enough that a copied URL dies. */
export const SIGNED_URL_TTL_SECONDS = 600;

export interface StoredFile {
  /** The path inside the bucket. This is what goes in `storage_path`. */
  path: string;
  contentType: string;
  size: number;
}

export class HubStorageError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'HubStorageError';
    this.status = status;
  }
}

/**
 * Where a file lives.
 *
 * `contractor/project/kind/uuid-filename`. The contractor id is the FIRST
 * segment on purpose: when storage policies are written (they are deferred
 * with table RLS, see 0002), the rule is a prefix match on that segment and
 * nothing has to be re-filed.
 *
 * The original filename is kept on the end because a homeowner downloading
 * `contract.pdf` should not receive `a3f9e2.pdf`, but it is prefixed with a
 * uuid so two people uploading `photo.jpg` do not collide.
 */
export function storagePath(
  contractorId: string,
  projectId: string,
  kind: 'photos' | 'documents',
  filename: string,
): string {
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
  return `${contractorId}/${projectId}/${kind}/${crypto.randomUUID()}-${safe}`;
}

export class HubStorage {
  private readonly url: string;
  private readonly key: string;

  constructor(url: string, key: string) {
    this.url = url;
    this.key = key;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, ...extra };
  }

  /**
   * Upload a file.
   *
   * Takes the contractor from the scope rather than the caller, so a file
   * cannot be written into another tenant's prefix by passing a different id.
   */
  async upload(
    scope: TenantScope,
    input: { projectId: string; kind: 'photos' | 'documents'; filename: string; contentType: string; body: ArrayBuffer | Uint8Array },
  ): Promise<StoredFile> {
    const contractorId = assertContractor(scope, 'upload');
    const path = storagePath(contractorId, input.projectId, input.kind, input.filename);

    const response = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': input.contentType,
        // Never overwrite. A path carries a uuid, so a collision means
        // something is wrong rather than something is a duplicate.
        'x-upsert': 'false',
      }),
      body: input.body as BodyInit,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new HubStorageError(`upload failed: ${response.status} ${text.slice(0, 200)}`, response.status);
    }

    return {
      path,
      contentType: input.contentType,
      size: input.body instanceof Uint8Array ? input.body.byteLength : input.body.byteLength,
    };
  }

  /**
   * A short-lived URL for one file.
   *
   * **Call this only after deciding the caller may see the record.** It does not
   * check permission itself — it cannot, because it does not know which record
   * the file belongs to. Minting a URL is the last step, not the check.
   */
  async signedUrl(scope: TenantScope, path: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string> {
    const contractorId = assertContractor(scope, 'signed url');

    // The path begins with the contractor id, so a caller cannot mint a URL for
    // another tenant's file by passing its path. Cheap, and it closes the one
    // hole a per-request signing endpoint would otherwise have.
    if (!path.startsWith(`${contractorId}/`)) {
      throw new HubStorageError('that file belongs to another contractor', null);
    }

    const response = await fetch(`${this.url}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new HubStorageError(`could not sign ${path}: ${response.status} ${text.slice(0, 200)}`, response.status);
    }

    const { signedURL } = (await response.json()) as { signedURL: string };
    return `${this.url}/storage/v1${signedURL}`;
  }

  /**
   * Remove a file.
   *
   * The only true delete in the Hub, and it exists because storage costs money
   * and an archived photo still occupies a bucket. The ROW is archived, never
   * deleted; this removes bytes whose row is already gone.
   */
  async remove(scope: TenantScope, path: string): Promise<void> {
    const contractorId = assertContractor(scope, 'remove file');
    if (!path.startsWith(`${contractorId}/`)) {
      throw new HubStorageError('that file belongs to another contractor', null);
    }

    const response = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      throw new HubStorageError(`could not remove ${path}: ${response.status}`, response.status);
    }
  }
}

export type HubStorageResult =
  | { available: true; storage: HubStorage }
  | { available: false; missing: string[] };

export function getHubStorage(): HubStorageResult {
  const result = readHubConfig();
  if (!result.configured) return { available: false, missing: result.missing };
  return { available: true, storage: new HubStorage(result.config.url, result.config.key) };
}
