/**
 * Schematic maps of every screen the walkthrough visits.
 *
 * GENERATED — do not edit by hand. Run `npm run hud:maps` with the dev server
 * up, which scrapes the real pages so nav labels, their order, section headings
 * and button text come from the app rather than from anyone's memory. The
 * hand-drawn version of this file was wrong about the portal nav, the project
 * detail panels, and the number of buttons on the review screen.
 *
 * Vertical order follows the DOM, which is the order a person reads the page in.
 * Deliberately crude: it has to be recognisable at a glance from a second
 * monitor, not accurate to the pixel.
 *
 * The two entries at the bottom are diagrams rather than screens, so they are
 * authored in `scripts/build-wireframes.mjs` and not scraped.
 */

export type BlockKind = 'sidebar' | 'nav' | 'header' | 'tile' | 'panel' | 'row' | 'button' | 'hero';

export interface Block {
  id: string;
  label?: string;
  kind: BlockKind;
  /** [start column, span] on a 12-column grid. */
  col: [number, number];
  /** [start row, span]. */
  row: [number, number];
}

export interface Screen {
  name: string;
  /** Shown under the map — which page the presenter should be on. */
  route: string;
  /** How many grid rows this screen's blocks occupy. */
  rows: number;
  blocks: Block[];
}

export const SCREENS = {
  signin: {
    name: "Sign in",
    route: "/",
    rows: 14,
    blocks: [
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "header", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'title', label: "One shared project record. Three controlled experiences.", kind: 'header', col: [4, 6], row: [3, 1] },
      { id: 'sec-sign-in', label: "Sign in", kind: 'panel', col: [4, 6], row: [4, 2] },
      { id: 'btn-sign-in', label: "Sign in", kind: 'button', col: [4, 6], row: [6, 1] },
    ],
  },

  dashboard: {
    name: "Contractor Dashboard",
    route: "/dashboard",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Portfolio Overview", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-projects-needing-attention', label: "Projects needing attention", kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'sec-review-queue', label: "Review queue", kind: 'panel', col: [4, 9], row: [6, 2] },
      { id: 'sec-waiting-on-the-client', label: "Waiting on the client", kind: 'panel', col: [4, 9], row: [8, 2] },
    ],
  },

  projects: {
    name: "Projects",
    route: "/dashboard/projects",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Projects", kind: 'header', col: [4, 9], row: [3, 1] },
    ],
  },

  project: {
    name: "Project detail",
    route: "/dashboard/projects/...",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Johnson Kitchen Remodel", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-timeline', label: "Timeline", kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'sec-field-updates', label: "Field updates", kind: 'panel', col: [4, 9], row: [6, 2] },
      { id: 'sec-financials', label: "Financials", kind: 'panel', col: [4, 9], row: [8, 2] },
      { id: 'sec-client-visibility', label: "Client visibility", kind: 'panel', col: [4, 9], row: [10, 2] },
      { id: 'sec-assigned-team', label: "Assigned team", kind: 'panel', col: [4, 9], row: [12, 2] },
    ],
  },

  visibility: {
    name: "Client Visibility Settings",
    route: "/dashboard/projects/.../visibility",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Client Visibility Settings", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-switches', label: "Switches", kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'sec-what-the-client-actually-gets', label: "What the client actually gets", kind: 'panel', col: [4, 9], row: [6, 2] },
      { id: 'sec-never-visible-whatever-the-switches-', label: "Never visible, whatever the switches say", kind: 'panel', col: [4, 9], row: [8, 2] },
      { id: 'btn-save-visibility', label: "Save visibility", kind: 'button', col: [4, 9], row: [10, 1] },
    ],
  },

  updates: {
    name: "Field Updates",
    route: "/dashboard/updates",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Field Updates", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-johnson-kitchen-remodel', label: "Johnson Kitchen Remodel", kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'sec-whitfield-master-suite-addition', label: "Whitfield Master Suite Addition", kind: 'panel', col: [4, 9], row: [6, 2] },
      { id: 'sec-published-to-clients', label: "Published to clients", kind: 'panel', col: [4, 9], row: [8, 2] },
      { id: 'btn-approve-and-publish', label: "Approve and Publish", kind: 'button', col: [4, 2], row: [10, 1] },
      { id: 'btn-approve-internally', label: "Approve Internally", kind: 'button', col: [6, 2], row: [10, 1] },
      { id: 'btn-edit-client-summary', label: "Edit Client Summary", kind: 'button', col: [8, 2], row: [10, 1] },
      { id: 'btn-return-for-revision', label: "Return for Revision", kind: 'button', col: [10, 2], row: [10, 1] },
    ],
  },

  buildsuite: {
    name: "Incoming from BuildSuite",
    route: "/dashboard/buildsuite",
    rows: 14,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 13] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-overview', label: "Overview", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-projects', label: "Projects", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-field-updates', label: "Field Updates", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-issues', label: "Issues", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-from-buildsuite', label: "From BuildSuite", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'title', label: "Incoming from BuildSuite", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-active-projects', label: "Active projects", kind: 'panel', col: [4, 9], row: [4, 2] },
    ],
  },

  portal: {
    name: "Client Portal — Dashboard",
    route: "/portal",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Johnson Kitchen Remodel", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'sec-upcoming-schedule', label: "Upcoming schedule", kind: 'panel', col: [4, 9], row: [4, 2] },
      { id: 'sec-budget-summary', label: "Budget summary", kind: 'panel', col: [4, 9], row: [6, 2] },
      { id: 'sec-recent-updates', label: "Recent updates", kind: 'panel', col: [4, 9], row: [8, 2] },
      { id: 'btn-review-and-approve', label: "Review and approve", kind: 'button', col: [4, 2], row: [10, 1] },
      { id: 'btn-pay-now', label: "Pay now", kind: 'button', col: [6, 2], row: [10, 1] },
      { id: 'btn-acknowledge', label: "Acknowledge", kind: 'button', col: [8, 2], row: [10, 1] },
      { id: 'btn-comment', label: "Comment", kind: 'button', col: [10, 2], row: [10, 1] },
    ],
  },

  portalTimeline: {
    name: "Project Timeline",
    route: "/portal/timeline",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Project Timeline", kind: 'header', col: [4, 9], row: [3, 1] },
    ],
  },

  portalUpdates: {
    name: "Daily Updates",
    route: "/portal/updates",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Daily Updates", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'btn-acknowledge', label: "Acknowledge", kind: 'button', col: [4, 4], row: [4, 1] },
      { id: 'btn-comment', label: "Comment", kind: 'button', col: [8, 4], row: [4, 1] },
    ],
  },

  portalDocuments: {
    name: "Document Center",
    route: "/portal/documents",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Document Center", kind: 'header', col: [4, 9], row: [3, 1] },
      { id: 'btn-download', label: "Download", kind: 'button', col: [4, 9], row: [4, 1] },
    ],
  },

  portalPhotos: {
    name: "Photos & Videos",
    route: "/portal/photos",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Photos & Videos", kind: 'header', col: [4, 9], row: [3, 1] },
    ],
  },

  portalDesigns: {
    name: "Designs & Selections",
    route: "/portal/designs",
    rows: 16,
    blocks: [
      { id: 'sidebar', kind: 'sidebar', col: [1, 3], row: [2, 15] },
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "project name", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'switcher', label: "Viewing as", kind: 'button', col: [10, 3], row: [2, 1] },
      { id: 'nav-dashboard', label: "Dashboard", kind: 'nav', col: [1, 3], row: [3, 1] },
      { id: 'nav-project-timeline', label: "Project Timeline", kind: 'nav', col: [1, 3], row: [4, 1] },
      { id: 'nav-schedule', label: "Schedule", kind: 'nav', col: [1, 3], row: [5, 1] },
      { id: 'nav-daily-updates', label: "Daily Updates", kind: 'nav', col: [1, 3], row: [6, 1] },
      { id: 'nav-designs-selections', label: "Designs & Selections", kind: 'nav', col: [1, 3], row: [7, 1] },
      { id: 'nav-budget-pricing', label: "Budget & Pricing", kind: 'nav', col: [1, 3], row: [8, 1] },
      { id: 'nav-change-orders', label: "Change Orders", kind: 'nav', col: [1, 3], row: [9, 1] },
      { id: 'nav-documents', label: "Documents", kind: 'nav', col: [1, 3], row: [10, 1] },
      { id: 'nav-photos-videos', label: "Photos & Videos", kind: 'nav', col: [1, 3], row: [11, 1] },
      { id: 'nav-messages', label: "Messages", kind: 'nav', col: [1, 3], row: [12, 1] },
      { id: 'nav-issues-requests', label: "Issues & Requests", kind: 'nav', col: [1, 3], row: [13, 1] },
      { id: 'nav-payments', label: "Payments", kind: 'nav', col: [1, 3], row: [14, 1] },
      { id: 'nav-completion-warranty', label: "Completion & Warranty", kind: 'nav', col: [1, 3], row: [15, 1] },
      { id: 'title', label: "Designs & Selections", kind: 'header', col: [4, 9], row: [3, 1] },
    ],
  },

  field: {
    name: "Field Interface",
    route: "/field",
    rows: 14,
    blocks: [
      { id: 'banner', label: "data banner", kind: 'header', col: [1, 12], row: [1, 1] },
      { id: 'context', label: "header", kind: 'header', col: [4, 6], row: [2, 1] },
      { id: 'title', label: "Today's tasks", kind: 'header', col: [4, 6], row: [3, 1] },
      { id: 'sec-add-daily-update', label: "Add daily update", kind: 'panel', col: [4, 6], row: [4, 2] },
      { id: 'sec-my-projects', label: "My projects", kind: 'panel', col: [4, 6], row: [6, 2] },
      { id: 'btn-start', label: "Start", kind: 'button', col: [4, 2], row: [8, 1] },
      { id: 'btn-complete', label: "Complete", kind: 'button', col: [6, 2], row: [8, 1] },
      { id: 'btn-submit-to-project-manager', label: "Submit to Project Manager", kind: 'button', col: [8, 2], row: [8, 1] },
    ],
  },

  // Not screens — the map slot is the only drawing surface the HUD has, and an
  // architecture question is far easier to answer with a shape on it.
  systems: {
    name: 'How the three systems fit',
    route: 'GoHighLevel -> BuildSuite -> back at signing -> Project Hub',
    rows: 14,
    blocks: [
      { id: 'ghl', label: 'GoHighLevel — leads, CRM', kind: 'panel', col: [1, 4], row: [2, 3] },
      { id: 'buildsuite', label: 'BuildSuite — estimating', kind: 'panel', col: [5, 4], row: [2, 3] },
      { id: 'hub', label: 'Project Hub', kind: 'button', col: [9, 4], row: [2, 3] },
      { id: 'inbound', label: 'leads in, deals get bid', kind: 'row', col: [1, 8], row: [6, 1] },
      { id: 'handoff', label: 'hands back at signing', kind: 'row', col: [3, 9], row: [7, 1] },
      { id: 'syncback', label: 'stage sync-back, read-only', kind: 'row', col: [5, 8], row: [8, 1] },
      { id: 'supabase', label: "Supabase — BuildSuite's", kind: 'panel', col: [1, 6], row: [10, 2] },
      { id: 'hubtables', label: 'hub_ tables — not yet created', kind: 'panel', col: [7, 6], row: [10, 2] },
      { id: 'browsers', label: 'Contractor    Field    Client', kind: 'sidebar', col: [1, 12], row: [13, 2] },
    ],
  },

  stack: {
    name: 'What sits between a client and the data',
    route: 'screens -> the gate -> data layer -> sources',
    rows: 14,
    blocks: [
      { id: 'ui', label: 'Screens', kind: 'panel', col: [2, 10], row: [2, 2] },
      { id: 'gate', label: 'The gate: 4 checks, then strip internals', kind: 'button', col: [2, 10], row: [5, 3] },
      { id: 'data', label: 'Data layer — every staff read needs a tenant', kind: 'panel', col: [2, 10], row: [9, 2] },
      { id: 'src-1', label: 'Supabase', kind: 'row', col: [2, 5], row: [12, 2] },
      { id: 'src-2', label: 'GoHighLevel API', kind: 'row', col: [7, 5], row: [12, 2] },
    ],
  },
} satisfies Record<string, Screen>;

export type ScreenId = keyof typeof SCREENS;
