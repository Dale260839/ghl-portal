/**
 * Schematic maps of every screen the walkthrough visits.
 *
 * Not decoration — the point of the HUD is that the presenter knows where the
 * mouse goes before they get there. Each step names a screen and a block, and
 * the map draws that block lit while the rest stays dim, so the shape of the
 * page is recognisable at a glance from a second monitor.
 *
 * Deliberately crude. A pixel-accurate mini-render would compete with the real
 * screen for attention; a grey box in roughly the right place does not.
 */

export type BlockKind = 'sidebar' | 'nav' | 'header' | 'tile' | 'panel' | 'row' | 'button' | 'hero';

export interface Block {
  id: string;
  label?: string;
  kind: BlockKind;
  /** [start column, span] on a 12-column grid. */
  col: [number, number];
  /** [start row, span] on a 14-row grid. */
  row: [number, number];
}

export interface Screen {
  name: string;
  /** Shown under the map — which page the presenter should be on. */
  route: string;
  blocks: Block[];
}

const CONTRACTOR_NAV = ['Overview', 'Projects', 'Field Updates', 'Issues', 'From BuildSuite'];

const PORTAL_NAV = [
  'Dashboard',
  'Timeline',
  'Schedule',
  'Daily Updates',
  'Designs',
  'Budget',
  'Change Orders',
  'Documents',
  'Photos',
  'Messages',
  'Issues',
];

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The furniture shared by every signed-in screen: banner, sidebar, context bar.
 * Nav labels are shortened hard — the map is for locating things, not reading.
 */
function chrome(nav: string[]): Block[] {
  const blocks: Block[] = [
    { id: 'banner', label: 'data banner', kind: 'header', col: [1, 12], row: [1, 1] },
    { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
    { id: 'context', label: 'project name', kind: 'header', col: [4, 6], row: [2, 1] },
    { id: 'switcher', label: 'Viewing as', kind: 'button', col: [10, 3], row: [2, 1] },
  ];

  nav.forEach((label, i) => {
    blocks.push({ id: `nav-${slug(label)}`, label, kind: 'nav', col: [1, 3], row: [3 + i, 1] });
  });

  return blocks;
}

export const SCREENS = {
  // ── Before the app ────────────────────────────────────────────────────────
  ghl: {
    name: 'GoHighLevel',
    route: 'app.gohighlevel.com',
    blocks: [
      { id: 'ghl-sidebar', kind: 'sidebar', col: [1, 3], row: [1, 14] },
      { id: 'ghl-nav', label: 'GHL menu', kind: 'nav', col: [1, 3], row: [2, 1] },
      { id: 'menu-link', label: 'Project Hub', kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'ghl-body', label: 'GHL dashboard', kind: 'panel', col: [4, 9], row: [1, 14] },
    ],
  },

  signin: {
    name: 'Sign in',
    route: '/',
    blocks: [
      { id: 'hero', label: 'One record, three views', kind: 'hero', col: [1, 7], row: [1, 14] },
      { id: 'form', label: 'Choose an experience', kind: 'panel', col: [8, 4], row: [5, 5] },
    ],
  },

  connecting: {
    name: 'Signing you in',
    route: '/auth/ghl',
    blocks: [{ id: 'spinner', label: 'Signing you in', kind: 'panel', col: [4, 6], row: [6, 3] }],
  },

  // ── Contractor ────────────────────────────────────────────────────────────
  dashboard: {
    name: 'Contractor Dashboard',
    route: '/dashboard',
    blocks: [
      ...chrome(CONTRACTOR_NAV),
      { id: 'title', label: 'Portfolio Overview', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'tile-1', label: 'Active', kind: 'tile', col: [4, 2], row: [4, 2] },
      { id: 'tile-2', label: 'Value', kind: 'tile', col: [6, 2], row: [4, 2] },
      { id: 'tile-3', label: 'Review', kind: 'tile', col: [8, 3], row: [4, 2] },
      { id: 'tile-4', label: 'Issues', kind: 'tile', col: [11, 2], row: [4, 2] },
      { id: 'attention', label: 'Projects needing attention', kind: 'panel', col: [4, 9], row: [6, 4] },
      { id: 'queue', label: 'Review queue', kind: 'panel', col: [4, 5], row: [10, 5] },
      { id: 'waiting', label: 'Waiting on the client', kind: 'panel', col: [9, 4], row: [10, 5] },
    ],
  },

  projects: {
    name: 'Projects',
    route: '/dashboard/projects',
    blocks: [
      ...chrome(CONTRACTOR_NAV),
      { id: 'title', label: 'Projects', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'row-1', label: 'Johnson Kitchen Remodel', kind: 'row', col: [4, 9], row: [5, 1] },
      { id: 'row-2', kind: 'row', col: [4, 9], row: [6, 1] },
      { id: 'row-3', kind: 'row', col: [4, 9], row: [7, 1] },
      { id: 'row-4', kind: 'row', col: [4, 9], row: [8, 1] },
      { id: 'row-5', kind: 'row', col: [4, 9], row: [9, 1] },
      { id: 'row-6', kind: 'row', col: [4, 9], row: [10, 1] },
    ],
  },

  project: {
    name: 'Project detail',
    route: '/dashboard/projects/...',
    blocks: [
      ...chrome(CONTRACTOR_NAV),
      { id: 'title', label: 'Johnson Kitchen Remodel', kind: 'header', col: [4, 6], row: [3, 1] },
      { id: 'visibility-btn', label: 'Client Visibility', kind: 'button', col: [10, 3], row: [3, 1] },
      { id: 'stage', label: 'Stage and progress', kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'financials', label: 'Contract, cost, margin', kind: 'panel', col: [4, 5], row: [6, 4] },
      { id: 'contacts', label: 'Client and crew', kind: 'panel', col: [9, 4], row: [6, 4] },
      { id: 'activity', label: 'Recent activity', kind: 'panel', col: [4, 9], row: [10, 5] },
    ],
  },

  visibility: {
    name: 'Client Visibility Settings',
    route: '/dashboard/projects/.../visibility',
    blocks: [
      ...chrome(CONTRACTOR_NAV),
      { id: 'title', label: 'Client Visibility Settings', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'switches', label: 'The switches', kind: 'panel', col: [4, 5], row: [4, 7] },
      { id: 'preview', label: 'What the client sees', kind: 'panel', col: [9, 4], row: [4, 4] },
      { id: 'never', label: 'Never visible, whatever the switches say', kind: 'panel', col: [9, 4], row: [8, 3] },
      { id: 'save', label: 'Save', kind: 'button', col: [4, 2], row: [11, 1] },
    ],
  },

  updates: {
    name: 'Field Updates',
    route: '/dashboard/updates',
    blocks: [
      ...chrome(CONTRACTOR_NAV),
      { id: 'title', label: 'Field Updates', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'pending', label: 'Awaiting your review', kind: 'panel', col: [4, 9], row: [4, 6] },
      { id: 'internal', label: 'Internal notes (red block)', kind: 'row', col: [5, 7], row: [6, 1] },
      { id: 'summary', label: 'Client summary, editable', kind: 'row', col: [5, 7], row: [8, 1] },
      { id: 'publish', label: 'Approve and Publish', kind: 'button', col: [5, 3], row: [10, 1] },
      { id: 'internal-only', label: 'Approve Internally', kind: 'button', col: [8, 3], row: [10, 1] },
      { id: 'return', label: 'Return for Revision', kind: 'button', col: [11, 2], row: [10, 1] },
      { id: 'published', label: 'Published to clients', kind: 'panel', col: [4, 9], row: [12, 3] },
    ],
  },

  // ── Client ────────────────────────────────────────────────────────────────
  portal: {
    name: 'Client Portal',
    route: '/portal',
    blocks: [
      ...chrome(PORTAL_NAV),
      { id: 'title', label: 'Johnson Kitchen Remodel', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'tracker', label: 'Six-stage tracker', kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'progress', label: 'Progress and next milestone', kind: 'panel', col: [4, 5], row: [6, 3] },
      { id: 'schedule', label: 'Upcoming schedule', kind: 'panel', col: [9, 4], row: [6, 3] },
      { id: 'budget', label: 'Budget summary', kind: 'panel', col: [4, 5], row: [9, 3] },
      { id: 'recent', label: 'Recent updates', kind: 'panel', col: [9, 4], row: [9, 3] },
    ],
  },

  portalTimeline: {
    name: 'Project Timeline',
    route: '/portal/timeline',
    blocks: [
      ...chrome(PORTAL_NAV),
      { id: 'title', label: 'Project Timeline', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'stage-1', label: 'Planning', kind: 'row', col: [4, 9], row: [5, 1] },
      { id: 'stage-2', label: 'Design', kind: 'row', col: [4, 9], row: [6, 1] },
      { id: 'stage-3', label: 'Materials', kind: 'row', col: [4, 9], row: [7, 1] },
      { id: 'stage-4', label: 'In Progress  <-- you are here', kind: 'row', col: [4, 9], row: [8, 1] },
      { id: 'stage-5', label: 'Inspection', kind: 'row', col: [4, 9], row: [9, 1] },
      { id: 'stage-6', label: 'Completed', kind: 'row', col: [4, 9], row: [10, 1] },
    ],
  },

  portalList: {
    name: 'A portal list screen',
    route: '/portal/updates, /documents, /photos',
    blocks: [
      ...chrome(PORTAL_NAV),
      { id: 'title', label: 'Screen title', kind: 'header', col: [4, 6], row: [3, 1] },
      { id: 'count', label: 'the item count', kind: 'header', col: [10, 3], row: [3, 1] },
      { id: 'item-1', kind: 'row', col: [4, 9], row: [5, 2] },
      { id: 'item-2', kind: 'row', col: [4, 9], row: [7, 2] },
      { id: 'item-3', kind: 'row', col: [4, 9], row: [9, 2] },
      { id: 'item-4', kind: 'row', col: [4, 9], row: [11, 2] },
    ],
  },

  portalPlaceholder: {
    name: 'A screen still being built',
    route: '/portal/designs, /budget, /change-orders',
    blocks: [
      ...chrome(PORTAL_NAV),
      { id: 'title', label: 'Designs and Selections', kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'coming', label: 'Coming shortly, and what it will do', kind: 'panel', col: [4, 9], row: [5, 5] },
    ],
  },

  // ── Diagrams, for the backend annex ───────────────────────────────────────
  // Not screens. The map slot is the only drawing surface the HUD has, and a
  // architecture question is much easier to answer with a shape on it.
  systems: {
    name: 'How the three systems fit',
    route: 'GoHighLevel -> BuildSuite -> back to GoHighLevel -> Project Hub',
    blocks: [
      { id: 'ghl', label: 'GoHighLevel — leads, CRM', kind: 'panel', col: [1, 4], row: [2, 3] },
      { id: 'buildsuite', label: 'BuildSuite — estimating', kind: 'panel', col: [5, 4], row: [2, 3] },
      { id: 'hub', label: 'Project Hub', kind: 'button', col: [9, 4], row: [2, 3] },
      { id: 'inbound', label: 'leads flow in, deals get bid', kind: 'row', col: [1, 8], row: [6, 1] },
      { id: 'handoff', label: 'Send-to-CRM handoff, once at signing', kind: 'row', col: [3, 9], row: [7, 1] },
      { id: 'syncback', label: 'stage sync-back, read-only', kind: 'row', col: [5, 8], row: [8, 1] },
      { id: 'supabase', label: 'Supabase — BuildSuite owns it', kind: 'panel', col: [1, 6], row: [10, 2] },
      { id: 'hubtables', label: 'hub_ tables — ours, not yet created', kind: 'panel', col: [7, 6], row: [10, 2] },
      { id: 'browsers', label: 'Contractor    Field    Client', kind: 'sidebar', col: [1, 12], row: [13, 2] },
    ],
  },

  stack: {
    name: 'What sits between a client and the data',
    route: 'screens -> the gate -> data layer -> sources',
    blocks: [
      { id: 'ui', label: 'Screens', kind: 'panel', col: [2, 10], row: [2, 2] },
      { id: 'gate', label: 'The gate: 4 checks, then strip the internals', kind: 'button', col: [2, 10], row: [5, 3] },
      { id: 'data', label: 'Data layer — every read needs a tenant', kind: 'panel', col: [2, 10], row: [9, 2] },
      { id: 'src-1', label: 'Supabase', kind: 'row', col: [2, 5], row: [12, 2] },
      { id: 'src-2', label: 'GoHighLevel API', kind: 'row', col: [7, 5], row: [12, 2] },
    ],
  },

  // ── Field ─────────────────────────────────────────────────────────────────
  field: {
    name: 'Field Interface',
    route: '/field',
    blocks: [
      { id: 'phone', label: 'phone width', kind: 'sidebar', col: [4, 6], row: [1, 14] },
      { id: 'today', label: 'Today', kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'project-pick', label: 'Which project', kind: 'row', col: [5, 4], row: [4, 1] },
      { id: 'work', label: 'Work completed', kind: 'panel', col: [5, 4], row: [5, 2] },
      { id: 'internal', label: 'Internal notes', kind: 'panel', col: [5, 4], row: [7, 2] },
      { id: 'client-note', label: 'Note for the client', kind: 'panel', col: [5, 4], row: [9, 2] },
      { id: 'submit', label: 'Submit to PM', kind: 'button', col: [5, 4], row: [12, 1] },
    ],
  },
} satisfies Record<string, Screen>;

export type ScreenId = keyof typeof SCREENS;
