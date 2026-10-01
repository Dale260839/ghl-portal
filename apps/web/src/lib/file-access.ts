import type { Access } from './access.ts';
import type { MediaItem } from './hub-db/media.ts';
import { isFieldFolder } from './document-folders.ts';

/** Both file lookup modes apply the same live role, grants and project rules. */
export function mayReadStaffFile(
  access: Access,
  item: Pick<MediaItem, 'kind' | 'category' | 'projectId'>,
  assignedIds: readonly string[],
): boolean {
  if (access.role === 'client' || !access.can('read', item.kind)) return false;
  if (access.role === 'contractor') {
    return access.projectIds === null || access.projectIds.includes(item.projectId);
  }
  if (item.kind === 'document' && !isFieldFolder(item.category)) return false;
  return assignedIds.includes(item.projectId);
}
