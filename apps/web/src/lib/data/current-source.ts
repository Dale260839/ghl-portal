import 'server-only';

import type { TenantScope } from '../tenancy.ts';
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
  return getDataSource(scope);
}

/** What the banner should say. */
export async function currentSourceKind(): Promise<DataSourceKind> {
  return activeSourceKind();
}
