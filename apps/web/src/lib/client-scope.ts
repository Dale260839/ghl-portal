import 'server-only';

import type { Access } from './access.ts';
import type { ProjectDataSource } from './data/source.ts';
import type { Project } from './data/types.ts';

/**
 * The projects a homeowner may see, in one place.
 *
 * There are two kinds of client and they arrive by different doors:
 *
 *   **Invited** — the contractor ticked projects for them on the Team screen.
 *   They hold no GoHighLevel contact id and no auth profile, so neither the
 *   contact read nor a scoped read can serve them. Their access IS the ticked
 *   list, read by id.
 *
 *   **Contact-linked** — a homeowner already in GoHighLevel, reached through
 *   `primaryContactId`. §1.4: they may hold several projects.
 *
 * Before this existed the invited case was handled by putting the MEMBERSHIP id
 * into `session.contactId` and looking it up as a contact. It matched nothing,
 * so every invited homeowner signed in successfully to an empty portal — the
 * failure was silent, which is the worst shape for a privacy-adjacent read.
 *
 * Neither path can over-return: one is constrained by an id list only a
 * contractor can write, the other by the contact key. Nothing here falls back
 * to "all projects" — when there is no way to identify the person, they get
 * nothing (§9.1).
 */
export async function clientProjectsFor(
  access: Access,
  db: ProjectDataSource,
): Promise<Project[]> {
  if (access.projectIds !== null) {
    return db.listProjectsByIds(access.projectIds);
  }

  const contactId = access.session.contactId;
  if (contactId === undefined || contactId.trim() === '') return [];
  return db.listProjectsForContact(contactId);
}
