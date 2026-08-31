import 'server-only';

import type { TenantScope } from '../tenancy.ts';
import { getHubOperational } from '../hub-db/operational.ts';
import { HubBackedDataSource } from './hub-backed-source.ts';
import {
  activeSourceKind,
  getDataSource,
  type DataSourceKind,
  type ProjectDataSource,
} from './source.ts';

/**
 * The data source for *this request*.
 *
 * This once wrapped `getDataSource` to honour a demo-data cookie that swapped
 * the whole app onto fixtures. That toggle is gone (D-017 retired), so these are
 * now thin pass-throughs — kept rather than inlined because every screen calls
 * them, and a source that later needs request state again has one place to go.
 */
export async function currentDataSource(scope?: TenantScope): Promise<ProjectDataSource> {
  const commercial = getDataSource(scope);

  // Fixtures already carry their own milestones and updates, so wrapping them
  // would replace a working demo with an empty database. Only the live sources
  // get the Hub bolted on.
  if (commercial.kind === 'fixture') return commercial;

  const hub = getHubOperational();
  if (!hub.available) return commercial;

  return new HubBackedDataSource(commercial, hub.ops);
}

/** What the banner should say. */
export async function currentSourceKind(): Promise<DataSourceKind> {
  return activeSourceKind();
}
