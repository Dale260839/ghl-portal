/**
 * §6.1 — the `Project` object, transcribed field for field.
 *
 * Purpose: field names are a verbatim contract (§0), and the same names are
 * typed by hand into the GHL object builder, the workflows, the dashboard, and
 * the portal. One mirror everything reads from means a typo shows up as a test
 * failure instead of an empty column three phases later.
 *
 * `clientVisible` here is the §6 `CV` column: *eligible* to reach a client, and
 * only if the record also passes the §9.1 gate. Absence means internal-only,
 * never client-facing.
 *
 * Only `Project` and `Daily Update` (§6.4, see daily-update.ts) are mirrored.
 * The other eight supporting objects get mirrored by the phase that consumes
 * them (§3.7 — ship slices).
 */

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'date'
  | 'bool'
  | 'select'
  | 'multiselect'
  | 'user'
  | 'file'
  | 'percent'
  | 'url'
  | 'email'
  | 'phone';

export interface FieldSpec {
  /** Display name, exactly as it must be typed into GHL. */
  readonly name: string;
  readonly type: FieldType;
  readonly group: 'Identity' | 'Status' | 'Dates' | 'Financials' | 'Visibility';
  /** §6 `CV` column — eligible for the client, subject to the §9.1 gate. */
  readonly clientVisible: boolean;
  /**
   * Per-project switch that must ALSO be on for this field to reach a client.
   * Only encoded where §6/§9.3 state the mapping explicitly.
   */
  readonly gatedBy?: readonly string[];
  /** In the Phase 1 demoable-core set (§14 Phase 1 / kickoff plan §9). */
  readonly demoableCore?: true;
  readonly notes?: string;
}

/**
 * §9.3: the client-visible financial allow-list is "still gated by
 * `Show Budget to Client` / `Show Detailed Pricing`" — stated for the group,
 * not per field. Which switch covers which field is NOT specified anywhere in
 * the architecture, so it is deliberately left as a group gate rather than
 * guessed at (§0).
 */
export const FINANCIAL_GATE = ['Show Budget to Client', 'Show Detailed Pricing'] as const;

export const PROJECT_FIELDS: readonly FieldSpec[] = [
  // ── Identity ───────────────────────────────────────────────────────────────
  { name: 'Project Name', type: 'text', group: 'Identity', clientVisible: true, demoableCore: true, notes: 'Primary display field' },
  { name: 'BuildSuite Project ID', type: 'text', group: 'Identity', clientVisible: false, demoableCore: true, notes: 'Shared key (§5), unique, immutable' },
  { name: 'Project Number', type: 'text', group: 'Identity', clientVisible: true },
  { name: 'Project Type', type: 'select', group: 'Identity', clientVisible: true, notes: 'construction/remodel/repair/maintenance/specialty' },
  { name: 'Project Description', type: 'longtext', group: 'Identity', clientVisible: true },
  { name: 'Project Address', type: 'text', group: 'Identity', clientVisible: true, demoableCore: true },
  { name: 'Property Type', type: 'select', group: 'Identity', clientVisible: true },
  { name: 'Client Name', type: 'text', group: 'Identity', clientVisible: true },
  { name: 'Primary Contact', type: 'user', group: 'Identity', clientVisible: false, demoableCore: true, notes: 'Association → Contact. A contact MAY have many projects (§1.4)' },
  { name: 'Project Manager', type: 'user', group: 'Identity', clientVisible: true, gatedBy: ['Show Assigned Team'], notes: 'Name only' },
  { name: 'Estimator', type: 'user', group: 'Identity', clientVisible: false },
  { name: 'Superintendent', type: 'user', group: 'Identity', clientVisible: true, gatedBy: ['Show Assigned Team'], notes: 'Name only' },
  { name: 'Sales Representative', type: 'user', group: 'Identity', clientVisible: false },

  // ── Status ─────────────────────────────────────────────────────────────────
  { name: 'Project Stage', type: 'select', group: 'Status', clientVisible: true, demoableCore: true, notes: 'Mirrors the Opportunity pipeline (§7), synced by WF2' },
  { name: 'Project Status', type: 'select', group: 'Status', clientVisible: true },
  { name: 'Progress Percentage', type: 'percent', group: 'Status', clientVisible: true, demoableCore: true, notes: 'The field wired in Phase 0 Test B (§15)' },
  { name: 'Current Milestone', type: 'text', group: 'Status', clientVisible: true, demoableCore: true },
  { name: 'Next Milestone', type: 'text', group: 'Status', clientVisible: true },
  { name: 'Client Action Required', type: 'bool', group: 'Status', clientVisible: true, notes: 'Drives the portal action queue' },
  { name: 'Internal Priority', type: 'select', group: 'Status', clientVisible: false, notes: '§9.3 deny-list' },
  { name: 'Health Status', type: 'select', group: 'Status', clientVisible: false, notes: 'On Track / Attention Needed / At Risk / Delayed / On Hold / Completed' },
  { name: 'Delay Reason', type: 'longtext', group: 'Status', clientVisible: false, notes: '§9.3 deny-list' },
  { name: 'Last Updated Date', type: 'date', group: 'Status', clientVisible: true, notes: 'Set by WF4 on publish (§11)' },
  { name: 'Last Updated By', type: 'user', group: 'Status', clientVisible: false },

  // ── Dates ──────────────────────────────────────────────────────────────────
  { name: 'Estimated Start Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Actual Start Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Estimated Completion Date', type: 'date', group: 'Dates', clientVisible: true, demoableCore: true },
  { name: 'Revised Completion Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Actual Completion Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Final Walkthrough Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Warranty Start Date', type: 'date', group: 'Dates', clientVisible: true },
  { name: 'Warranty Expiration Date', type: 'date', group: 'Dates', clientVisible: true },

  // ── Financials ─────────────────────────────────────────────────────────────
  { name: 'Original Estimate', type: 'currency', group: 'Financials', clientVisible: false, notes: '§9.3 deny-list' },
  { name: 'Contract Amount', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE, demoableCore: true, notes: 'From the §8.2 handoff' },
  { name: 'Approved Change Orders', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Pending Change Orders', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Current Project Total', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE, notes: 'Recalculated by WF6' },
  { name: 'Amount Invoiced', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Amount Paid', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Remaining Balance', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Next Payment Amount', type: 'currency', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },
  { name: 'Next Payment Due Date', type: 'date', group: 'Financials', clientVisible: true, gatedBy: FINANCIAL_GATE },

  // ── Client-visibility controls ─────────────────────────────────────────────
  // Switches themselves are never client-facing.
  { name: 'Client Portal Enabled', type: 'bool', group: 'Visibility', clientVisible: false, demoableCore: true, notes: 'Master switch — a clause of the §9.1 gate' },
  { name: 'Show Budget to Client', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Show Detailed Pricing', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Show Schedule to Client', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Show Assigned Team', type: 'bool', group: 'Visibility', clientVisible: false, notes: 'Gates Project Manager / Superintendent names' },
  { name: 'Allow Client Messaging', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Allow Issue Submission', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Allow File Uploads', type: 'bool', group: 'Visibility', clientVisible: false },
  { name: 'Portal Access Status', type: 'select', group: 'Visibility', clientVisible: false },
];

export function projectField(name: string): FieldSpec | undefined {
  return PROJECT_FIELDS.find((f) => f.name === name);
}

/** The Phase 1 build list. Nothing else gets created in Phase 1 (§14). */
export function demoableCoreFields(): FieldSpec[] {
  return PROJECT_FIELDS.filter((f) => f.demoableCore === true);
}

/** CV-eligible fields. Still subject to the §9.1 gate and any `gatedBy` switch. */
export function clientEligibleFields(): FieldSpec[] {
  return PROJECT_FIELDS.filter((f) => f.clientVisible);
}

/**
 * Resolves which Project fields a given client may actually see, applying both
 * the CV column and the per-project switches. Does NOT apply the §9.1 gate —
 * call `evaluateGate` first; this only narrows the field set afterwards.
 *
 * OPEN: `gatedBy` is treated as OR — any one listed switch grants the field.
 * §9.3 writes the financial gate as "Show Budget to Client / Show Detailed
 * Pricing" without saying whether that slash means either-or or both. Flagged
 * in KICKOFF.md §5; if it should be AND, change `.some` to `.every` here and
 * the tests will tell you what else moves.
 */
export function visibleProjectFields(switches: Readonly<Record<string, boolean>>): FieldSpec[] {
  return clientEligibleFields().filter(
    (f) => f.gatedBy === undefined || f.gatedBy.some((s) => switches[s] === true),
  );
}
