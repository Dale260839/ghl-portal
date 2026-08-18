import 'server-only';

/**
 * Server-only re-export of the client projection.
 *
 * ARCHITECTURE §13: "Every client-facing read passes through the §9.1 gate
 * server-side / at the data layer — the UI must never be the only enforcement."
 * The `server-only` import makes that structural: if any of this is pulled into
 * a client component, the build fails.
 *
 * The logic lives in `client-projection.ts` so it stays unit-testable. Import
 * from here in pages; import from there in tests.
 */
export {
  toClientProject,
  toClientUpdates,
  toClientMilestones,
  type ClientProjectView,
  type ClientUpdateView,
  type ClientMilestoneView,
  type ProjectProjection,
} from './client-projection';
