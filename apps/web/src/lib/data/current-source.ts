import 'server-only';

import { isDemoData } from '../demo-mode.ts';
import type { TenantScope } from '../tenancy.ts';
import {
  activeSourceKind,
  fixtureDataSource,
  getDataSource,
  type DataSourceKind,
  type ProjectDataSource,
} from './source.ts';

/**
 * The data source for *this request*, honouring the demo toggle.
 *
 * `getDataSource` picks between GHL, BuildSuite and fixtures from configuration
 * alone and stays free of request state so it can be tested. This is the thin
 * layer above it that reads the cookie, so screens call one function and never
 * have to remember the toggle exists.
 */
export async function currentDataSource(scope?: TenantScope): Promise<ProjectDataSource> {
  if (await isDemoData()) return fixtureDataSource();
  return getDataSource(scope);
}

/** What the banner should say — the toggle wins over configuration. */
export async function currentSourceKind(): Promise<DataSourceKind> {
  if (await isDemoData()) return 'fixture';
  return activeSourceKind();
}
