import { SubmitButton } from '@/components/submit-button';
import { attachProjectFile, archiveProjectFile, updateProjectFile } from '@/lib/actions';
import { Badge, Card, CardHeader, shortDate } from '@/components/ui';
import { ControlEmpty, VisibilityTag } from '@/components/control';
import { type MediaItem, type MediaKind } from '@/lib/hub-db/media';
import {
  ALL_FOLDERS,
  CLIENT_FOLDER,
  DEFAULT_FOLDER,
  UNSORTED_LABEL,
  folderLabel,
  isClientFolder,
  isFieldFolder,
} from '@/lib/document-folders';

/**
 * The add-and-manage surface for documents and photos.
 *
 * ---------------------------------------------------------------------------
 * ONE COMPONENT FOR BOTH, FOR THE SAME REASON THE REPOSITORY IS ONE MODULE
 *
 * The two screens differ by a noun and one field. Two copies would be the same
 * rules written twice, and the second copy is the one that stops matching when
 * the release rule changes.
 *
 * Documents have folders and photos do not, so the folder controls are the one
 * place the two screens diverge. That divergence is a handful of `isDoc`
 * branches rather than a second component, because everything around them —
 * upload, link, open, archive — is still identical.
 * ---------------------------------------------------------------------------
 *
 * Every file is private in the bucket. Nothing here links directly to storage —
 * the download route mints a short-lived signed URL after checking the caller
 * is the owning contractor, so a copied link is dead within minutes.
 */

const FIELD = 'rounded-lg border border-navy-200 px-3 py-2 text-sm';

interface FolderGroup {
  /** The value a Move-to select would submit. Blank for the legacy bucket. */
  value: string;
  label: string;
  items: MediaItem[];
}

/** Every folder in display order, then the legacy rows, then drop the empties. */
function groupByFolder(items: MediaItem[]): FolderGroup[] {
  const groups: FolderGroup[] = ALL_FOLDERS.map((folder) => ({
    value: folder,
    label: folder,
    items: items.filter((item) => folderLabel(item.category) === folder),
  }));
  // Unsorted last: a legacy row is real work that still needs filing, so it
  // stays on screen rather than being hidden for not matching the new scheme.
  groups.push({
    value: '',
    label: UNSORTED_LABEL,
    items: items.filter((item) => folderLabel(item.category) === UNSORTED_LABEL),
  });
  return groups.filter((group) => group.items.length > 0);
}

function FolderSelect({ value, id }: { value: string; id?: string }) {
  const known = ALL_FOLDERS.includes(value);
  return (
    <select name="category" id={id} defaultValue={known ? value : ''} className={FIELD}>
      {!known && <option value="">{UNSORTED_LABEL}, pick a folder</option>}
      {ALL_FOLDERS.map((folder) => (
        <option key={folder} value={folder}>
          {folder}
        </option>
      ))}
    </select>
  );
}

export function MediaManager({
  kind,
  projectId,
  items,
  released,
  hub,
}: {
  kind: MediaKind;
  projectId: string;
  items: MediaItem[];
  /** The project-level switch. Both it and the row must be on. */
  released: boolean;
  hub: { available: boolean; missing: string[] };
}) {
  const isDoc = kind === 'document';
  const noun = isDoc ? 'document' : 'photo';

  if (!hub.available) {
    return (
      <ControlEmpty
        title="The Hub database is not connected"
        body={`Missing: ${hub.missing.join(', ')}. Files cannot be listed or saved.`}
      />
    );
  }

  const groups = isDoc ? groupByFolder(items) : [{ value: '', label: '', items }];

  return (
    <>
      <Card>
        <CardHeader title={isDoc ? 'Add a document' : 'Add a photo'} />
        <form action={attachProjectFile} className="grid gap-3 px-5 py-4 sm:grid-cols-4">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="kind" value={kind} />

          <input
            name="label"
            required={isDoc}
            placeholder={isDoc ? 'Title, e.g. Signed permit' : 'Caption (optional)'}
            className={`${FIELD} sm:col-span-2`}
          />
          {isDoc ? (
            <label className="text-xs text-navy-500">
              Folder
              <span className="mt-1 block">
                <FolderSelect value={DEFAULT_FOLDER} />
              </span>
            </label>
          ) : (
            <span />
          )}
          <SubmitButton
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-700"
          >
            Add
          </SubmitButton>

          <label className="text-xs text-navy-500 sm:col-span-2">
            Upload a file
            <input
              type="file"
              name="file"
              accept={isDoc ? '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,image/*' : 'image/*'}
              className={`${FIELD} mt-1 w-full`}
            />
          </label>
          <label className="text-xs text-navy-500 sm:col-span-2">
            …or paste a link
            <input
              name="externalUrl"
              type="url"
              placeholder="https://…"
              className={`${FIELD} mt-1 w-full`}
            />
          </label>

          <p className="text-xs text-navy-400 sm:col-span-4">
            {/* Saying which, rather than leaving them to discover it. */}
            One or the other is required.{' '}
            {isDoc
              ? 'Nothing is shared until you release it, and releasing puts it in the Client folder.'
              : `Saved internal — release it to the client with the switch on the ${noun}.`}
          </p>
        </form>
      </Card>

      {items.length === 0 ? (
        <ControlEmpty
          title={isDoc ? 'No documents yet' : 'No photos yet'}
          body={`Add the first ${noun} for this project.`}
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label} className="space-y-3">
              {isDoc && (
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-navy-900">{group.label}</h2>
                  <span className="text-xs text-navy-400">
                    {group.items.length} {group.items.length === 1 ? 'document' : 'documents'}
                  </span>
                  {group.label === CLIENT_FOLDER && (
                    <span className="text-xs text-navy-400">
                      The only folder the homeowner can see into
                    </span>
                  )}
                  {group.label === UNSORTED_LABEL && (
                    <span className="text-xs text-navy-400">
                      Filed before folders existed. Move each one to a folder.
                    </span>
                  )}
                </div>
              )}

              {group.items.map((item) => (
                <MediaCard
                  key={item.id}
                  item={item}
                  kind={kind}
                  projectId={projectId}
                  released={released}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function MediaCard({
  item,
  kind,
  projectId,
  released,
}: {
  item: MediaItem;
  kind: MediaKind;
  projectId: string;
  released: boolean;
}) {
  const isDoc = kind === 'document';
  const noun = isDoc ? 'document' : 'photo';
  const route = isDoc ? 'documents' : 'photos';
  const inFieldFolder = isDoc && isFieldFolder(item.category);
  const inClientFolder = isDoc && isClientFolder(item.category);

  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-navy-900">
          {item.label || (isDoc ? 'Untitled document' : 'Untitled photo')}
        </span>
        {isDoc ? (
          <Badge tone="neutral">{folderLabel(item.category)}</Badge>
        ) : (
          item.category !== '' && <Badge tone="neutral">{item.category}</Badge>
        )}
        {/* Both halves: the row's own flag AND the project switch. */}
        <VisibilityTag shown={released && item.clientVisible && !inFieldFolder} />
        <span className="ml-auto text-xs text-navy-400">
          {shortDate(item.createdAt)} · {item.uploadedBy ?? 'unknown'}
        </span>
      </div>

      {inClientFolder && !item.clientVisible && (
        <p className="mt-1 text-xs text-navy-500">In Client folder, not released yet</p>
      )}

      <div className="mt-1 text-xs">
        {item.externalUrl !== null ? (
          <a
            href={item.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-navy-600 underline underline-offset-2"
          >
            Open link
          </a>
        ) : item.storagePath !== null ? (
          <a
            href={`/api/files?path=${encodeURIComponent(item.storagePath)}`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-navy-600 underline underline-offset-2"
          >
            Open file
          </a>
        ) : (
          <span className="text-navy-400">No file attached</span>
        )}
      </div>

      <form action={updateProjectFile} className="mt-3 grid gap-2 sm:grid-cols-4">
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="kind" value={kind} />
        <input
          name="label"
          defaultValue={item.label}
          required={isDoc}
          className={`${FIELD} sm:col-span-2`}
        />
        {isDoc ? (
          <label className="text-xs text-navy-500">
            Move to
            <span className="mt-1 block">
              <FolderSelect value={item.category} id={`folder-${item.id}`} />
            </span>
          </label>
        ) : (
          <span />
        )}
        <SubmitButton
          className="rounded-lg border border-navy-200 px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50"
        >
          Save
        </SubmitButton>

        {inFieldFolder ? (
          // No checkbox at all, not a disabled one: an unchecked box that
          // cannot be ticked still reads as "someone could tick this".
          <p className="text-xs text-navy-500 sm:col-span-4">
            Field folders are never shown to the homeowner.
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2 text-xs text-navy-600 sm:col-span-4">
              <input
                type="checkbox"
                name="clientVisible"
                defaultChecked={item.clientVisible}
                className="rounded border-navy-300"
              />
              Show this {noun} to the client
            </label>
            {isDoc && (
              <p className="text-xs text-navy-400 sm:col-span-4">
                Releasing puts it in the Client folder.
              </p>
            )}
          </>
        )}
      </form>

      {/* Archives the row and leaves the file in the bucket. Removing
          the object would break any signed URL already issued. */}
      <form action={archiveProjectFile} className="mt-2 border-t border-navy-100 pt-2">
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="kind" value={kind} />
        <SubmitButton className="text-xs font-medium text-red-700 transition hover:underline">
          Remove from {route}
        </SubmitButton>
      </form>
    </Card>
  );
}
